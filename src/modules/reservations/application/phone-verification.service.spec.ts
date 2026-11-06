import { PhoneVerificationPort } from '../../../shared/domain/ports/phone-verification.port';
import { PhoneVerificationService, normalizePhone } from './phone-verification.service';

function setup(valid = true) {
  const port: jest.Mocked<PhoneVerificationPort> = {
    sendCode: jest.fn().mockResolvedValue(undefined),
    checkCode: jest.fn().mockResolvedValue(valid),
  };
  return { port, svc: new PhoneVerificationService(port) };
}

describe('PhoneVerificationService', () => {
  it('normaliza celulares colombianos', () => {
    expect(normalizePhone('+57 300 123 4567')).toBe('3001234567');
    expect(() => normalizePhone('12345')).toThrow();
  });

  it('envía el código y respeta la espera de 60 s para reenviar', async () => {
    const { port, svc } = setup();
    await svc.sendCode('3001234567');
    expect(port.sendCode).toHaveBeenCalledWith('3001234567');
    await expect(svc.sendCode('3001234567')).rejects.toThrow(/Espera/);
  });

  it('con código válido entrega un token que solo sirve para ese celular', async () => {
    const { svc } = setup(true);
    const { token } = await svc.verify('3001234567', '123456');
    expect(() => svc.assertToken(token, '3001234567')).not.toThrow();
    expect(() => svc.assertToken(token, '3009999999')).toThrow();
    expect(() => svc.assertToken(token + 'x', '3001234567')).toThrow();
    expect(() => svc.assertToken(undefined, '3001234567')).toThrow();
  });

  it('bloquea tras 5 intentos fallidos', async () => {
    const { port, svc } = setup(false);
    for (let i = 0; i < 5; i++) await expect(svc.verify('3001234567', '000000')).rejects.toThrow();
    await expect(svc.verify('3001234567', '000000')).rejects.toThrow(/Demasiados intentos/);
    expect(port.checkCode).toHaveBeenCalledTimes(5);
  });
});
