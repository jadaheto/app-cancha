import { Injectable, Logger } from '@nestjs/common';
import { AppEnv, loadEnv } from '../../config/env';
import {
  MessagingPort,
  OutboundMessage,
} from '../../domain/ports/messaging.port';

/** Tope de caracteres del parámetro de la plantilla de WhatsApp. */
const MAX_MENSAJE = 1000;

/**
 * Adaptador de mensajería que envía WhatsApp a través del webhook de n8n
 * (campaña WiseCX), NO por la API de Meta directamente. Portado de
 * N8nWhatsappSender de vigia-ssf: POST multipart/form-data con
 * `telefonos`, `campaign_id`, `mensaje` (texto libre) y `wait_seconds`,
 * autenticado con una cabecera Authorization Basic.
 *
 * Como el webhook recibe texto libre (no plantillas con parámetros), este
 * adaptador compone el mensaje a partir de la plantilla de dominio y sus
 * variables.
 */
@Injectable()
export class N8nWhatsappMessagingAdapter implements MessagingPort {
  private readonly logger = new Logger(N8nWhatsappMessagingAdapter.name);
  private readonly cfg: AppEnv['whatsapp'];

  constructor() {
    this.cfg = loadEnv().whatsapp;
  }

  private isConfigured(): boolean {
    return !!this.cfg.webhookUrl && !!this.cfg.campaignId;
  }

  async send(
    message: OutboundMessage,
  ): Promise<{ delivered: boolean; providerMessageId?: string }> {
    if (!this.isConfigured()) {
      this.logger.warn(
        `WhatsApp (n8n) no configurado: faltan WHATSAPP_WEBHOOK_URL o WHATSAPP_CAMPAIGN_ID. Mensaje omitido para ${message.to}.`,
      );
      return { delivered: false };
    }

    const telefono = this.normalizar(message.to);
    if (telefono.length < 7) {
      this.logger.warn(`WhatsApp no enviado: celular inválido (${message.to}).`);
      return { delivered: false };
    }

    const texto = N8nWhatsappMessagingAdapter.sanear(this.componer(message));
    const form = new FormData();
    form.append('telefonos', telefono);
    form.append('campaign_id', this.cfg.campaignId);
    form.append('mensaje', texto);
    form.append('wait_seconds', String(this.cfg.waitSeconds));
    const headers: Record<string, string> = {};
    if (this.cfg.authorization) headers.Authorization = this.cfg.authorization;

    try {
      const response = await fetch(this.cfg.webhookUrl, {
        method: 'POST',
        headers,
        body: form,
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
      const body = (await response.text()).slice(0, 500);
      if (!response.ok) {
        this.logger.warn(
          `WhatsApp (n8n) a ${telefono} falló HTTP ${response.status}: ${body || 'sin detalle'}`,
        );
        return { delivered: false };
      }
      // n8n responde p. ej. {"aceptado":true,"execution_id":"484977"}.
      let providerMessageId: string | undefined;
      try {
        const json = JSON.parse(body) as { execution_id?: string | number };
        if (json.execution_id !== undefined) {
          providerMessageId = String(json.execution_id);
        }
      } catch {
        /* respuesta no-JSON: se ignora */
      }
      this.logger.log(
        `WhatsApp (n8n) aceptado para ${telefono} (exec ${providerMessageId ?? 'n/d'}).`,
      );
      return { delivered: true, providerMessageId };
    } catch (error) {
      const err = error as Error;
      const detalle =
        err.name === 'TimeoutError' || err.name === 'AbortError'
          ? `tiempo de espera agotado (${Math.round(this.cfg.timeoutMs / 1000)} s)`
          : err.message;
      this.logger.warn(
        `WhatsApp (n8n) a ${telefono} sin respuesta del webhook: ${detalle}`,
      );
      return { delivered: false };
    }
  }

  /** Compone el texto del mensaje según la plantilla de dominio. */
  private componer(message: OutboundMessage): string {
    const v = message.variables ?? {};
    switch (message.template) {
      case 'verification_code':
        return `Comfasucre canchas: tu código de verificación es ${v.code ?? ''}. Vence en 10 minutos. Si no solicitaste esta reserva, ignora este mensaje.`;
      // Mensajes en una sola línea (sin saltos): el webhook los envía como
      // parámetro de plantilla de WhatsApp, que no admite \n.
      case 'reservation_confirmed':
        return (
          `¡Hola ${v.nombre ?? ''}! Tu pago fue confirmado y tu reserva ${v.reserva_no ?? ''} quedó confirmada ` +
          `para el ${v.fecha ?? ''} de ${v.hora ?? ''} en ${v.cancha ?? ''} (${v.lugar ?? ''}). ` +
          `Valor pagado: ${v.valor ?? ''}. Gracias por reservar con Comfasucre.`
        );
      case 'reservation_reminder':
        return (
          `Hola ${v.nombre ?? ''}, tu reserva ${v.reserva_no ?? ''} tiene un pago pendiente de ${v.monto ?? ''}.` +
          (v.enlace_pago ? ` Paga aquí: ${v.enlace_pago}.` : '') +
          ` Comfasucre.`
        );
      default:
        return Object.values(v).join(' ');
    }
  }

  /** Solo dígitos; antepone el prefijo de país a los celulares de 10 dígitos si está configurado. */
  private normalizar(telefono: string): string {
    let d = (telefono ?? '').replace(/\D/g, '');
    if (
      this.cfg.prefijoPais &&
      d.length === 10 &&
      !d.startsWith(this.cfg.prefijoPais)
    ) {
      d = this.cfg.prefijoPais + d;
    }
    return d;
  }

  /**
   * El texto viaja como parámetro de una plantilla de WhatsApp (error #132018 si
   * lleva saltos de línea, tabulaciones o más de 4 espacios seguidos): se unen las
   * líneas con " · " y se colapsan los espacios.
   */
  static sanear(mensaje: string, max = MAX_MENSAJE): string {
    const texto = (mensaje ?? '')
      .split(/[\r\n\t]+/)
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' · ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return texto.length > max ? texto.slice(0, max - 1) + '…' : texto;
  }
}
