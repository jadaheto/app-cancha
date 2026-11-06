export const PHONE_VERIFICATION = Symbol('PHONE_VERIFICATION');

/**
 * Puerto de verificación del celular (OTP). El proveedor genera, envía y
 * valida el código; el dominio solo pide enviarlo y comprobarlo.
 */
export interface PhoneVerificationPort {
  /** Envía un código al celular. Lanza error si el proveedor no lo aceptó. */
  sendCode(phone: string): Promise<void>;
  /** true si el código es válido para ese celular. */
  checkCode(phone: string, code: string): Promise<boolean>;
}
