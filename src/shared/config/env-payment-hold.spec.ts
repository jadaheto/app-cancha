import { loadEnv } from './env';

describe('Variables de vencimiento de pago', () => {
  const realEnv = { ...process.env };
  afterEach(() => { process.env = { ...realEnv }; });

  it('valores por defecto: 10 min portal, 10 min panel, 60 min de margen, revisión cada 60 s', () => {
    for (const k of ['PAYMENT_HOLD_MINUTES', 'PAYMENT_HOLD_MINUTES_ADMIN', 'PAYMENT_GRACE_MINUTES', 'PAYMENT_EXPIRY_CHECK_SECONDS']) delete process.env[k];
    expect(loadEnv().paymentHold).toEqual({ minutes: 10, adminMinutes: 10, graceMinutes: 60, checkSeconds: 60 });
  });

  it('el panel hereda PAYMENT_HOLD_MINUTES si su variable está vacía', () => {
    process.env.PAYMENT_HOLD_MINUTES = '15';
    process.env.PAYMENT_HOLD_MINUTES_ADMIN = '';
    expect(loadEnv().paymentHold).toMatchObject({ minutes: 15, adminMinutes: 15 });
  });

  it('valores inválidos usan el valor por defecto; 0 desactiva la revisión', () => {
    process.env.PAYMENT_HOLD_MINUTES = 'abc';
    process.env.PAYMENT_HOLD_MINUTES_ADMIN = '30';
    process.env.PAYMENT_EXPIRY_CHECK_SECONDS = '0';
    expect(loadEnv().paymentHold).toMatchObject({ minutes: 10, adminMinutes: 30, checkSeconds: 0 });
  });
});
