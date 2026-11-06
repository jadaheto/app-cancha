import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AppEnv, loadEnv } from '../../config/env';
import { PhoneVerificationPort } from '../../domain/ports/phone-verification.port';

/**
 * Verificación del celular con los webhooks de n8n de Comfasucre:
 * - `enviar-codigo`  (POST multipart `phone`, Authorization Basic): n8n genera
 *   el código y lo envía por WhatsApp.
 * - `validar-codigo` (POST multipart `phone`, `codigo`): n8n responde si es válido.
 */
@Injectable()
export class N8nPhoneVerificationAdapter implements PhoneVerificationPort {
  private readonly logger = new Logger(N8nPhoneVerificationAdapter.name);
  private readonly cfg: AppEnv['phoneVerification'];

  constructor() {
    this.cfg = loadEnv().phoneVerification;
  }

  async sendCode(phone: string): Promise<void> {
    const form = new FormData();
    form.append('phone', phone);
    const res = await this.post(this.cfg.sendUrl, form, this.cfg.sendAuthorization);
    // HTTP 200 con un cuerpo que indica fallo explícito ({"success":false}, "error"…) también es fallo.
    if (!res.ok || isExplicitFailure(res.body)) {
      this.logger.warn(`enviar-codigo a ${mask(phone)} falló HTTP ${res.status}: ${res.body}`);
      throw new ServiceUnavailableException('No se ha podido enviar el código, intenta de nuevo en unos minutos');
    }
    this.logger.log(`Código enviado a ${mask(phone)} (n8n: ${res.body || 'sin cuerpo'})`);
  }

  async checkCode(phone: string, code: string): Promise<boolean> {
    const form = new FormData();
    form.append('phone', phone);
    form.append('codigo', code);
    const res = await this.post(this.cfg.validateUrl, form, this.cfg.validateAuthorization);
    // Se registra la respuesta para poder ajustar la interpretación si n8n cambia.
    this.logger.log(`validar-codigo ${mask(phone)} → HTTP ${res.status}: ${res.body || 'sin cuerpo'}`);
    if (res.status >= 500) {
      throw new ServiceUnavailableException('No pudimos validar el código, intenta de nuevo en unos minutos');
    }
    return res.ok && isValidResponse(res.body);
  }

  private async post(url: string, body: FormData, authorization: string): Promise<{ ok: boolean; status: number; body: string }> {
    if (!url) throw new ServiceUnavailableException('Verificación de celular no configurada');
    const headers: Record<string, string> = {};
    if (authorization) headers.Authorization = authorization;
    try {
      const response = await fetch(url, {
        method: 'POST', headers, body, signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
      return { ok: response.ok, status: response.status, body: (await response.text()).slice(0, 500) };
    } catch (error) {
      this.logger.warn(`Webhook ${url} sin respuesta: ${describeFetchError(error)}`);
      throw new ServiceUnavailableException('El servicio de verificación no responde, intenta de nuevo en unos minutos');
    }
  }
}

const TRUTHY = new Set(['true', '1', 'ok', 'valid', 'valido', 'válido', 'approved', 'aprobado', 'verified', 'verificado', 'success', 'exitoso', 'correcto']);
const FALSY = new Set(['false', '0', 'invalid', 'invalido', 'inválido', 'rejected', 'error', 'expired', 'expirado', 'incorrecto', 'fail', 'failed']);
const FLAG_KEYS = ['valid', 'valido', 'válido', 'isValid', 'is_valid', 'verified', 'verificado', 'success', 'ok', 'aprobado', 'approved', 'resultado', 'result', 'status', 'estado'];

/**
 * Interpreta la respuesta de `validar-codigo` sin depender de un único formato:
 * `true`, `"valido"`, `{"valido":true}`, `{"success":true}`, `{"status":"approved"}`,
 * `[{"valido":true}]`… Cualquier cosa no reconocida se considera NO válida.
 */
export function isValidResponse(raw: string): boolean {
  const text = (raw ?? '').trim();
  if (!text) return false;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return TRUTHY.has(text.toLowerCase().replace(/^"|"$/g, ''));
  }
  return interpret(data) === true;
}

/** true solo si la respuesta dice explícitamente que falló (un cuerpo vacío o desconocido no lo es). */
export function isExplicitFailure(raw: string): boolean {
  const text = (raw ?? '').trim();
  if (!text) return false;
  try {
    return interpret(JSON.parse(text)) === false;
  } catch {
    return FALSY.has(text.toLowerCase().replace(/^"|"$/g, ''));
  }
}

function interpret(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (TRUTHY.has(v)) return true;
    if (FALSY.has(v)) return false;
    return null;
  }
  if (Array.isArray(value)) return value.length ? interpret(value[0]) : null;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of FLAG_KEYS) {
      if (key in obj) {
        const r = interpret(obj[key]);
        if (r !== null) return r;
      }
    }
    for (const nested of ['data', 'body', 'json']) {
      if (nested in obj) {
        const r = interpret(obj[nested]);
        if (r !== null) return r;
      }
    }
  }
  return null;
}

function mask(phone: string): string {
  return phone.length > 4 ? `${'*'.repeat(phone.length - 4)}${phone.slice(-4)}` : phone;
}

/**
 * "fetch failed" no dice nada: la causa real viene en `error.cause`
 * (ENOTFOUND = DNS, ECONNREFUSED = puerto cerrado, UND_ERR_CONNECT_TIMEOUT /
 * ETIMEDOUT = firewall o IP no autorizada, CERT_* = certificado TLS…).
 */
export function describeFetchError(error: unknown): string {
  const err = error as Error & { cause?: { code?: string; message?: string; errors?: Array<{ code?: string; message?: string }> } };
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'tiempo de espera agotado';
  const cause = err?.cause;
  const inner = cause?.errors?.[0];
  const code = cause?.code ?? inner?.code;
  const detail = cause?.message ?? inner?.message;
  const hint: Record<string, string> = {
    ENOTFOUND: 'no se resuelve el dominio (DNS)',
    EAI_AGAIN: 'DNS temporalmente no disponible',
    ECONNREFUSED: 'conexión rechazada (puerto cerrado o servicio caído)',
    ECONNRESET: 'la conexión fue cortada por el servidor o un firewall',
    ETIMEDOUT: 'sin respuesta: posible firewall o IP no autorizada',
    UND_ERR_CONNECT_TIMEOUT: 'no se pudo conectar en 10 s: posible firewall o IP no autorizada',
    EHOSTUNREACH: 'servidor inalcanzable desde esta red',
    ENETUNREACH: 'red inalcanzable',
  };
  const parts = [err?.message ?? String(error)];
  if (code) parts.push(`${code}${hint[code] ? ` (${hint[code]})` : ''}`);
  if (detail && !parts.some((p) => p.includes(detail))) parts.push(detail);
  return parts.join(' · ');
}
