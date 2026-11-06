import { Body, Controller, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import {
  EpaycoConfirmationPayload,
  ReservationsService,
} from '../application/reservations.service';

/** Cuerpo/variables x_* que envía ePayco en la confirmación (POST). */
interface EpaycoConfirmationBody {
  x_ref_payco?: string;
  x_transaction_id?: string;
  x_amount?: string;
  x_currency_code?: string;
  x_cod_response?: string;
  x_response?: string;
  x_id_invoice?: string;
  [key: string]: unknown;
}

/**
 * Webhook PÚBLICO de ePayco (no lleva JWT: lo llama ePayco servidor a servidor).
 * Recibe la confirmación de pago, valida la firma y marca la reserva como pagada.
 * La URL se configura en EPAYCO_CONFIRMATION_URL y se adjunta como
 * p_url_confirmation al generar el checkout.
 */
@ApiExcludeController()
@Controller('webhooks/epayco')
export class EpaycoWebhookController {
  constructor(private readonly reservations: ReservationsService) {}

  @Post('confirmation')
  @HttpCode(HttpStatus.OK)
  async confirmation(
    @Body() body: EpaycoConfirmationBody,
    @Query('invoice_number') invoiceQuery?: string,
  ): Promise<{ ok: boolean; status: string }> {
    const payload: EpaycoConfirmationPayload = {
      // El id de factura viaja en el cuerpo (x_id_invoice) y, de respaldo, en la query.
      invoice: str(body.x_id_invoice) || str(invoiceQuery),
      refPayco: str(body.x_ref_payco),
      transactionId: str(body.x_transaction_id),
      amount: str(body.x_amount),
      currency: str(body.x_currency_code) || 'COP',
      codResponse: str(body.x_cod_response),
      signature: str((body as Record<string, unknown>).x_signature),
      testRequest: str((body as Record<string, unknown>).x_test_request),
    };
    return this.reservations.confirmEpaycoPayment(payload);
  }

  /**
   * Respuesta (redirección del pagador tras el checkout). No decide el pago
   * —eso lo hace `confirmation`— pero confirma recepción con 200.
   */
  @Post('response')
  @HttpCode(HttpStatus.OK)
  response(): { ok: boolean } {
    return { ok: true };
  }
}

function str(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).trim();
}
