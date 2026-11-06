export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

export interface PaymentIntent {
  reservationId: string;
  amount: number;
  description: string;
  customerEmail?: string;
  customerName?: string;
}

export interface PaymentIntentResult {
  /** Identificador de la transacción en la pasarela. */
  reference: string;
  /** URL de checkout a la que redirigir al cliente (si aplica). */
  checkoutUrl: string;
  status: 'pending' | 'approved' | 'rejected';
}

/** Resultado de consultar una transacción en la pasarela por su referencia. */
export interface PaymentVerification {
  status: 'pending' | 'approved' | 'rejected';
  /** Número de factura de la transacción (= id de la reserva). */
  invoice?: string | null;
  /** Monto cobrado. */
  amount?: number | null;
  currency?: string | null;
  /** true si la pasarela ya validó la firma y el monto (intermediario de recaudo). */
  verifiedByGateway?: boolean;
  /** true si fue una transacción de prueba (sandbox). */
  testRequest?: boolean | null;
  refPayco?: string | null;
  transactionId?: string | null;
  /** Texto de ePayco ("Aceptada", "Rechazada"…). */
  responseMessage?: string | null;
  /** Medio de pago (VISA, PSE, Nequi…). */
  franchise?: string | null;
  /** Fecha de la transacción según ePayco. */
  transactionDate?: string | null;
}

/**
 * Puerto de pasarela de pagos. El sistema original integraba ePayco (PSE);
 * aquí es un puerto con adaptador stub por defecto.
 */
export interface PaymentGatewayPort {
  createIntent(intent: PaymentIntent): Promise<PaymentIntentResult>;
  /**
   * Consulta en la pasarela el pago de una factura (= id de la reserva). `refPayco`
   * (opcional) es la referencia que ePayco agrega al volver del checkout.
   * Nunca confía en lo que diga el navegador.
   */
  verify(query: { invoice: string; refPayco?: string }): Promise<PaymentVerification>;
}
