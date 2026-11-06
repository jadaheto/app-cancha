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

describe('PhoneVerificationService · límite por IP', () => {
  it('máximo 10 envíos por hora desde la misma IP aunque sean celulares distintos', async () => {
    const port = { sendCode: jest.fn().mockResolvedValue(undefined), checkCode: jest.fn() };
    const svc = new PhoneVerificationService(port);
    for (let i = 0; i < 10; i++) await svc.sendCode(`30000000${String(i).padStart(2, '0')}`, '1.2.3.4');
    await expect(svc.sendCode('3000000099', '1.2.3.4')).rejects.toThrow(/demasiados códigos/);
    await expect(svc.sendCode('3000000099', '5.6.7.8')).resolves.toBeDefined();
    expect(port.sendCode).toHaveBeenCalledTimes(11);
  });
});
