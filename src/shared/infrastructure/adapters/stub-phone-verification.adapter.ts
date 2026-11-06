import { Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'crypto';
import { PhoneVerificationPort } from '../../domain/ports/phone-verification.port';

/**
 * Verificación de prueba (desarrollo local): genera el código y lo escribe en
 * el log del backend en lugar de enviarlo. No usar en producción.
 */
@Injectable()
export class StubPhoneVerificationAdapter implements PhoneVerificationPort {
  private readonly logger = new Logger('StubPhoneVerification');
  private readonly codes = new Map<string, { code: string; expiresAt: number }>();

  async sendCode(phone: string): Promise<void> {
    const code = randomInt(100000, 1000000).toString();
    this.codes.set(phone, { code, expiresAt: Date.now() + 10 * 60_000 });
    this.logger.warn(`[STUB] Código de verificación para ${phone}: ${code}`);
  }

  async checkCode(phone: string, code: string): Promise<boolean> {
    const entry = this.codes.get(phone);
    if (!entry || entry.expiresAt < Date.now() || entry.code !== code) return false;
    this.codes.delete(phone);
    return true;
  }
}
