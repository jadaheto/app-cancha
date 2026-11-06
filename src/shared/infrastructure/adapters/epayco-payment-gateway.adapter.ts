import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'crypto';
import { AppEnv, loadEnv } from '../../config/env';
import {
  PaymentGatewayPort,
  PaymentIntent,
  PaymentIntentResult,
  PaymentVerification,
} from '../../domain/ports/payment-gateway.port';

/**
 * Adaptador real de ePayco (cuenta "Recreación y Deporte" de Comfasucre).
 *
 * Genera un link de pago firmado hacia la integración personalizada de ePayco
 * (checkout.php, parámetros p_*), igual que el servicio epayco_reacudo_rd:
 *
 *   p_signature = md5(p_cust_id_cliente ^ p_key ^ p_id_invoice ^ p_amount ^ p_currency_code)
 *
 * donde p_key es la P_KEY de "Llaves secretas" del panel (o la pública si no hay
 * P_KEY). La confirmación definitiva del pago llega por el webhook de ePayco.
 */
@Injectable()
export class EpaycoPaymentGatewayAdapter implements PaymentGatewayPort {
  private readonly logger = new Logger(EpaycoPaymentGatewayAdapter.name);
  private readonly cfg: AppEnv['epayco'];

  // APIs públicas de validación de referencia (no dependen de la cuenta).
  private static readonly REFERENCE_URLS = [
    'https://secure.epayco.co/validation/v1/reference/',
    'https://api.secure.payco.co/validation/v1/reference/',
  ];

  constructor() {
    this.cfg = loadEnv().epayco;
  }

  async createIntent(intent: PaymentIntent): Promise<PaymentIntentResult> {
    if (!this.cfg.merchantId || (!this.cfg.pKey && !this.cfg.publicKey)) {
      throw new ServiceUnavailableException(
        'Configura EPAYCO_P_CUST_ID y EPAYCO_P_KEY/EPAYCO_PUBLIC_KEY antes de cobrar con ePayco.',
      );
    }

    const currency = 'COP';
    const invoice = intent.reservationId;
    const amount = this.formatAmount(intent.amount);
    const checkoutKey = this.cfg.pKey || this.cfg.publicKey;
    const signature = this.md5(
      `${this.cfg.merchantId}^${checkoutKey}^${invoice}^${amount}^${currency}`,
    );

    const params: Record<string, string> = {
      p_cust_id_cliente: this.cfg.merchantId,
      p_key: checkoutKey,
      p_id_invoice: invoice,
      p_description: intent.description.trim(),
      p_amount: amount,
      p_amount_base: amount,
      p_tax: '0.00',
      p_currency_code: currency,
      p_email: intent.customerEmail?.trim() ?? '',
      p_name: intent.customerName?.trim() ?? '',
      p_extra1: intent.reservationId,
      p_signature: signature,
      p_test_request: this.cfg.testMode ? 'true' : 'false',
      test: this.cfg.testMode ? 'true' : 'false',
    };
    if (this.cfg.accountId) params.p_id_account = this.cfg.accountId;
    if (this.cfg.confirmationUrl) {
      params.p_url_confirmation = this.withQuery(this.cfg.confirmationUrl, invoice);
    }
    if (this.cfg.responseUrl) {
      params.p_url_response = this.withQuery(this.cfg.responseUrl, invoice);
    }

    const checkoutUrl = `${this.cfg.checkoutUrl}?${new URLSearchParams(params).toString()}`;
    this.logger.log(
      `Checkout ePayco (Recreación y Deporte) generado para reserva ${intent.reservationId} por $${amount} ${currency}`,
    );

    return { reference: invoice, checkoutUrl, status: 'pending' };
  }

  /**
   * Verifica una transacción contra la API pública de ePayco. Solo da un
   * resultado firme cuando `reference` es el ref_payco que ePayco asignó
   * (normalmente llega en el webhook/retorno); con el número de factura aún
   * sin pagar devuelve "pending".
   */
  async verify(query: { invoice: string; refPayco?: string }): Promise<PaymentVerification> {
    // ePayco directo solo puede consultar por ref_payco.
    const ref = (query.refPayco ?? '').trim();
    if (ref === '') return { status: 'pending' };

    for (const base of EpaycoPaymentGatewayAdapter.REFERENCE_URLS) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15_000);
        const res = await fetch(base + encodeURIComponent(ref), {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!res.ok) continue;
        const body = (await res.json()) as { success?: boolean; data?: Record<string, unknown> };
        if (body?.success === false || !body?.data) continue;
        return parseEpaycoValidation(body.data);
      } catch (error) {
        this.logger.warn(
          `No se pudo verificar la referencia ${ref}: ${(error as Error).message}`,
        );
      }
    }
    return { status: 'pending' };
  }

  /** Dos decimales, punto, sin separador de miles (formato de firma de ePayco). */
  private formatAmount(value: number): string {
    return (Number.isFinite(value) ? value : 0).toFixed(2);
  }

  private withQuery(url: string, invoice: string): string {
    try {
      const parsed = new URL(url);
      if (!parsed.searchParams.has('invoice')) {
        parsed.searchParams.set('invoice', invoice);
      }
      return parsed.toString();
    } catch {
      return url;
    }
  }

  private md5(value: string): string {
    return createHash('md5').update(value, 'utf8').digest('hex');
  }
}

/**
 * Interpreta `data` de la API de validación de ePayco
 * (GET /validation/v1/reference/{ref_payco}).
 */
export function parseEpaycoValidation(data: Record<string, unknown>): PaymentVerification {
  const text = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());
  const cod = Number(text(data.x_cod_response) || text(data.x_cod_transaction_state));
  const response = text(data.x_response).toLowerCase();
  const status: PaymentVerification['status'] =
    cod === 1 || response.includes('acept')
      ? 'approved'
      : cod === 2 || cod === 4 || cod === 9 || cod === 10 || cod === 11 || response.includes('rechaz') || response.includes('fallid')
        ? 'rejected'
        : 'pending';
  const amount = parseFloat(text(data.x_amount).replace(',', '.'));
  const test = text(data.x_test_request).toLowerCase();
  return {
    status,
    invoice: text(data.x_id_invoice) || text(data.x_id_factura) || null,
    amount: Number.isFinite(amount) ? amount : null,
    currency: text(data.x_currency_code) || null,
    testRequest: test === '' ? null : test === 'true' || test === '1',
    refPayco: text(data.x_ref_payco) || null,
    transactionId: text(data.x_transaction_id) || null,
    responseMessage: text(data.x_response) || null,
    franchise: text(data.x_franchise) || null,
    transactionDate: text(data.x_transaction_date) || text(data.x_fecha_transaccion) || null,
  };
}
