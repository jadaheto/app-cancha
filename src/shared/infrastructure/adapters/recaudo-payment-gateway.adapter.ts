import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AppEnv, loadEnv } from '../../config/env';
import {
  PaymentGatewayPort,
  PaymentIntent,
  PaymentIntentResult,
  PaymentVerification,
} from '../../domain/ports/payment-gateway.port';
import { describeFetchError } from './n8n-phone-verification.adapter';

/** Transacción tal como la devuelve GET /epayco/transactions del intermediario. */
export interface RecaudoTransaction {
  refPayco?: string | null;
  transactionId?: string;
  invoiceNumber?: string;
  amount?: number | string;
  currency?: string;
  status?: string;
  signatureValid?: boolean;
  amountOk?: boolean;
  account?: string | null;
  payload?: Record<string, unknown> | null;
  responseMessage?: string;
  franchise?: string;
  transactionDate?: string;
  createdAt?: string;
}

/**
 * Pagos a través del intermediario de Comfasucre **epayco_reacudo_rd**
 * (https://pagos.comfasucre.co). El intermediario firma el checkout con las llaves
 * de la cuenta ePayco, recibe las confirmaciones de ePayco, valida firma y monto
 * y guarda cada transacción. appCancha solo:
 *  - crea el checkout:      POST /epayco/checkout            (x-api-key)
 *  - consulta el resultado: GET  /epayco/transactions?invoiceNumber=  (x-api-key)
 *  - fuerza la consulta a ePayco si vuelve con ref_payco: POST /epayco/transactions/:ref/sync
 * La factura del checkout es el id de la reserva.
 */
@Injectable()
export class RecaudoPaymentGatewayAdapter implements PaymentGatewayPort {
  private readonly logger = new Logger(RecaudoPaymentGatewayAdapter.name);
  private readonly cfg: AppEnv['recaudo'];
  private readonly responseUrl: string;

  constructor() {
    const env = loadEnv();
    this.cfg = env.recaudo;
    this.responseUrl = env.epayco.responseUrl;
    if (!this.cfg.apiKey) {
      this.logger.warn('RECAUDO_API_KEY no está definida: no se podrán crear ni verificar pagos.');
    }
  }

  async createIntent(intent: PaymentIntent): Promise<PaymentIntentResult> {
    const body: Record<string, unknown> = {
      account: this.cfg.account,
      sourceApp: this.cfg.sourceApp,
      invoiceNumber: intent.reservationId,
      description: (intent.description || 'Reserva de cancha').slice(0, 255),
      amount: Math.round(intent.amount * 100) / 100,
      currency: 'COP',
      extra1: intent.reservationId,
    };
    if (intent.customerName) body.payerName = intent.customerName.slice(0, 255);
    if (intent.customerEmail) body.payerEmail = intent.customerEmail;
    if (this.responseUrl) body.responseUrl = withInvoice(this.responseUrl, intent.reservationId);
    if (this.cfg.testMode !== null) body.testMode = this.cfg.testMode;

    const res = await this.request('POST', '/epayco/checkout', body);
    if (!res.ok) {
      this.logger.warn(`Checkout de la reserva ${intent.reservationId} rechazado (HTTP ${res.status}): ${res.text.slice(0, 300)}`);
      throw new ServiceUnavailableException('No se pudo generar el link de pago. Intenta de nuevo en unos minutos.');
    }
    const data = res.json as { id?: string; checkoutUrl?: string; testMode?: boolean };
    if (!data?.checkoutUrl) {
      throw new ServiceUnavailableException('La pasarela no devolvió el link de pago.');
    }
    this.logger.log(
      `Checkout ${data.id} creado para la reserva ${intent.reservationId} ($${intent.amount}${data.testMode ? ', MODO PRUEBA' : ''}).`,
    );
    return { reference: data.id ?? intent.reservationId, checkoutUrl: data.checkoutUrl, status: 'pending' };
  }

  async verify(query: { invoice: string; refPayco?: string }): Promise<PaymentVerification> {
    const ref = (query.refPayco ?? '').trim();
    if (ref) {
      // El cliente volvió del checkout: se pide al intermediario consultar ePayco ya
      // (por si la confirmación servidor a servidor aún no llegó). Si falla, se sigue.
      const sync = await this.request('POST', `/epayco/transactions/${encodeURIComponent(ref)}/sync`).catch(() => null);
      if (sync && !sync.ok && sync.status !== 404) {
        this.logger.warn(`Sync de ${ref} respondió HTTP ${sync.status}: ${sync.text.slice(0, 200)}`);
      }
    }

    const qs = new URLSearchParams({ invoiceNumber: query.invoice, account: this.cfg.account });
    const res = await this.request('GET', `/epayco/transactions?${qs.toString()}`).catch(() => null);
    if (!res?.ok || !Array.isArray(res.json)) {
      if (res) this.logger.warn(`Consulta de pagos de ${query.invoice} falló (HTTP ${res.status}).`);
      return { status: 'pending', invoice: query.invoice };
    }
    return pickTransaction(res.json as RecaudoTransaction[], query.invoice);
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<{ ok: boolean; status: number; text: string; json: unknown }> {
    if (!this.cfg.apiKey) throw new ServiceUnavailableException('Pasarela de pagos no configurada (RECAUDO_API_KEY).');
    const headers: Record<string, string> = { 'x-api-key': this.cfg.apiKey, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    try {
      const response = await fetch(`${this.cfg.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
      const text = await response.text();
      let json: unknown = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* no JSON */ }
      return { ok: response.ok, status: response.status, text, json };
    } catch (error) {
      this.logger.warn(`Intermediario de pagos sin respuesta (${method} ${path}): ${describeFetchError(error)}`);
      throw new ServiceUnavailableException('La pasarela de pagos no responde. Intenta de nuevo en unos minutos.');
    }
  }
}

/**
 * Elige la transacción que decide el estado de la factura:
 * 1) una APROBADA que el intermediario validó (firma + monto) → aprobada;
 * 2) si no, la más reciente (pendiente o rechazada).
 * Una aprobada sin firma o monto válidos se ignora (no se puede confiar en ella).
 */
export function pickTransaction(rows: RecaudoTransaction[], invoice: string): PaymentVerification {
  const own = rows.filter((t) => (t.invoiceNumber ?? '') === invoice);
  const approved = own.find((t) => t.status === 'approved' && t.signatureValid === true && t.amountOk === true);
  const chosen = approved ?? own.find((t) => t.status !== 'approved') ?? null;
  if (!chosen) return { status: 'pending', invoice };

  const amount = typeof chosen.amount === 'number' ? chosen.amount : parseFloat(String(chosen.amount ?? ''));
  const rawTest = String(chosen.payload?.['x_test_request'] ?? '').trim().toLowerCase();
  const status: PaymentVerification['status'] =
    chosen === approved ? 'approved' : chosen.status === 'rejected' ? 'rejected' : 'pending';
  return {
    status,
    invoice: chosen.invoiceNumber ?? invoice,
    amount: Number.isFinite(amount) ? amount : null,
    currency: chosen.currency ?? null,
    testRequest: rawTest === '' ? null : rawTest === 'true' || rawTest === '1',
    refPayco: chosen.refPayco ?? null,
    transactionId: chosen.transactionId ?? null,
    verifiedByGateway: chosen === approved,
    responseMessage: chosen.responseMessage || null,
    franchise: chosen.franchise || null,
    transactionDate: chosen.transactionDate || chosen.createdAt || null,
  };
}

/** Agrega ?invoice=<id> a la URL de respuesta (la página /reserva lo lee). */
function withInvoice(url: string, invoice: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set('invoice', invoice);
    return u.toString();
  } catch {
    return url;
  }
}
