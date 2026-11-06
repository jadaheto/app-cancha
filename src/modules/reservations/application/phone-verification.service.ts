import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { loadEnv } from '../../../shared/config/env';
import { DomainValidationException } from '../../../shared/domain/exceptions/domain.exception';
import {
  PHONE_VERIFICATION,
  PhoneVerificationPort,
} from '../../../shared/domain/ports/phone-verification.port';

const RESEND_COOLDOWN_MS = 60_000;
const MAX_SENDS_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 10 * 60_000;

interface PhoneState {
  sends: number[];      // marcas de tiempo de envíos (última hora)
  attempts: number[];   // marcas de tiempo de intentos fallidos (ventana de 10 min)
}

/** Celular colombiano: 10 dígitos que empiezan por 3. */
export function normalizePhone(phone: string): string {
  const digits = (phone ?? '').replace(/\D/g, '').replace(/^57(?=3\d{9}$)/, '');
  if (!/^3\d{9}$/.test(digits)) {
    throw new DomainValidationException('Ingresa un celular colombiano válido de 10 dígitos');
  }
  return digits;
}

/**
 * Caso de uso: verificar que el celular del cliente es real antes de reservar.
 * 1) `sendCode` pide al proveedor (n8n) que envíe un código por WhatsApp.
 * 2) `verify` valida el código y entrega un token firmado de corta duración.
 * 3) Al crear la reserva, `assertToken` comprueba que el token corresponde
 *    a ese celular. Límites anti-abuso por celular: reenvío cada 60 s,
 *    5 envíos por hora y 5 intentos fallidos cada 10 minutos.
 */
@Injectable()
export class PhoneVerificationService {
  private readonly state = new Map<string, PhoneState>();
  private readonly secret: string;
  private readonly ttlMs: number;

  constructor(@Inject(PHONE_VERIFICATION) private readonly provider: PhoneVerificationPort) {
    const env = loadEnv();
    // Clave distinta a la del JWT del panel: un token de celular nunca sirve como sesión admin.
    this.secret = createHmac('sha256', env.jwt.secret).update('phone-verification').digest('hex');
    this.ttlMs = env.phoneVerification.tokenTtlMinutes * 60_000;
  }

  async sendCode(rawPhone: string): Promise<{ sent: true; phone: string; retryAfterSeconds: number }> {
    const phone = normalizePhone(rawPhone);
    const now = Date.now();
    const st = this.get(phone, now);
    const last = st.sends[st.sends.length - 1];
    if (last && now - last < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((RESEND_COOLDOWN_MS - (now - last)) / 1000);
      throw new HttpException(`Espera ${wait} s para solicitar un nuevo código`, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (st.sends.length >= MAX_SENDS_PER_HOUR) {
      throw new HttpException('Has solicitado demasiados códigos. Intenta más tarde', HttpStatus.TOO_MANY_REQUESTS);
    }
    await this.provider.sendCode(phone);
    st.sends.push(now);
    st.attempts = [];
    return { sent: true, phone: maskPhone(phone), retryAfterSeconds: RESEND_COOLDOWN_MS / 1000 };
  }

  async verify(rawPhone: string, rawCode: string): Promise<{ token: string; expiresAt: Date }> {
    const phone = normalizePhone(rawPhone);
    const code = (rawCode ?? '').replace(/\s/g, '');
    if (!/^\d{4,8}$/.test(code)) throw new DomainValidationException('El código debe tener solo números');
    const now = Date.now();
    const st = this.get(phone, now);
    if (st.attempts.length >= MAX_ATTEMPTS) {
      throw new HttpException('Demasiados intentos. Solicita un nuevo código', HttpStatus.TOO_MANY_REQUESTS);
    }
    const ok = await this.provider.checkCode(phone, code);
    if (!ok) {
      st.attempts.push(now);
      const left = MAX_ATTEMPTS - st.attempts.length;
      throw new DomainValidationException(
        left > 0
          ? `El código ingresado es incorrecto o venció. Te quedan ${left} ${left === 1 ? 'intento' : 'intentos'}`
          : 'Demasiados intentos. Solicita un nuevo código',
      );
    }
    this.state.delete(phone);
    const expiresAt = new Date(now + this.ttlMs);
    return { token: this.sign(phone, expiresAt.getTime()), expiresAt };
  }

  /** Lanza error si el token no es válido para ese celular o ya venció. */
  assertToken(token: string | undefined, rawPhone: string | undefined): void {
    const fail = () => {
      throw new DomainValidationException('Debes verificar tu número celular con el código antes de reservar');
    };
    if (!token || !rawPhone) return fail();
    const phone = normalizePhone(rawPhone);
    const [body, mac] = token.split('.');
    if (!body || !mac) return fail();
    const expected = Buffer.from(this.mac(body));
    const given = Buffer.from(mac);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return fail();
    let payload: { p?: string; e?: number };
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      return fail();
    }
    if (payload.p !== phone || !payload.e || payload.e < Date.now()) return fail();
  }

  private sign(phone: string, exp: number): string {
    const body = Buffer.from(JSON.stringify({ p: phone, e: exp })).toString('base64url');
    return `${body}.${this.mac(body)}`;
  }

  private mac(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url');
  }

  private get(phone: string, now: number): PhoneState {
    const st = this.state.get(phone) ?? { sends: [], attempts: [] };
    st.sends = st.sends.filter((t) => now - t < 3_600_000);
    st.attempts = st.attempts.filter((t) => now - t < ATTEMPT_WINDOW_MS);
    this.state.set(phone, st);
    return st;
  }
}

function maskPhone(phone: string): string {
  return `${phone.slice(0, 3)} *** ${phone.slice(-4)}`;
}
