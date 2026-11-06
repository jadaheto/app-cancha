import { MessagingPort } from '../../../shared/domain/ports/messaging.port';
import { PaymentGatewayPort, PaymentVerification } from '../../../shared/domain/ports/payment-gateway.port';
import { CourtsService } from '../../courts/application/courts.service';
import { SettingsService } from '../../settings/application/settings.service';
import { UsersService } from '../../users/application/users.service';
import { PaymentStatus, Reservation, ReservationStatus } from '../domain/reservation';
import { ReservationRepository } from '../domain/reservation.repository';
import { ReservationsService } from './reservations.service';

// La firma del webhook se prueba aparte (epayco-signature); aquí se da por válida.
jest.mock('../../../shared/infrastructure/adapters/epayco-signature.util', () => ({
  isEpaycoConfirmationValid: () => true,
}));

const ID = '11111111-1111-4111-8111-111111111111';

function setup(opts: { verification?: PaymentVerification; testMode?: boolean } = {}) {
  process.env.EPAYCO_TEST = opts.testMode === false ? 'false' : 'true';
  const store = new Map<string, Reservation>();
  store.set(ID, new Reservation({
    id: ID, courtId: 'c1', courtName: 'Cancha 1', userName: 'Ana', userPhone: '3015894392',
    startTime: new Date('2026-11-15T18:00:00-05:00'), endTime: new Date('2026-11-15T19:00:00-05:00'),
    totalAmount: 65000, paymentStatus: PaymentStatus.PENDING,
  }));
  const repo = {
    findById: async (id: string) => store.get(id) ?? null,
    update: async (r: Reservation) => { store.set(r.id, r); return r; },
  } as unknown as ReservationRepository;
  const messaging: jest.Mocked<MessagingPort> = { send: jest.fn().mockResolvedValue({ delivered: true }) };
  const payments: jest.Mocked<PaymentGatewayPort> = {
    createIntent: jest.fn(),
    verify: jest.fn().mockResolvedValue(opts.verification ?? { status: 'pending' }),
  };
  const courts = { findById: async () => ({ venueName: 'Sede', location: null }) } as unknown as CourtsService;
  const svc = new ReservationsService(repo, courts, {} as UsersService, messaging, payments, {} as SettingsService);
  return { svc, store, messaging, payments };
}

const webhook = (over: Record<string, string> = {}) => ({
  invoice: ID, refPayco: 'REF1', transactionId: 'T1', amount: '65000.00', currency: 'COP',
  codResponse: '1', signature: 'x', testRequest: 'true', ...over,
});

afterAll(() => { delete process.env.EPAYCO_TEST; });

describe('Confirmación de pago ePayco (webhook)', () => {
  it('pago aceptado con el monto correcto → pagada, confirmada y WhatsApp', async () => {
    const { svc, store, messaging } = setup();
    expect(await svc.confirmEpaycoPayment(webhook())).toEqual({ ok: true, status: 'paid' });
    expect(store.get(ID)!.paymentStatus).toBe(PaymentStatus.PAID);
    expect(store.get(ID)!.status).toBe(ReservationStatus.CONFIRMED);
    expect(messaging.send).toHaveBeenCalledTimes(1);
  });

  it('monto distinto al de la reserva → no se marca pagada', async () => {
    const { svc, store, messaging } = setup();
    expect(await svc.confirmEpaycoPayment(webhook({ amount: '1000.00' }))).toEqual({ ok: false, status: 'amount_mismatch' });
    expect(store.get(ID)!.paymentStatus).not.toBe(PaymentStatus.PAID);
    expect(messaging.send).not.toHaveBeenCalled();
  });

  it('en producción (EPAYCO_TEST=false) rechaza transacciones de prueba', async () => {
    const { svc, store } = setup({ testMode: false });
    expect(await svc.confirmEpaycoPayment(webhook({ testRequest: 'true' }))).toEqual({ ok: false, status: 'test_transaction' });
    expect(store.get(ID)!.paymentStatus).not.toBe(PaymentStatus.PAID);
    expect(await svc.confirmEpaycoPayment(webhook({ testRequest: 'false' }))).toEqual({ ok: true, status: 'paid' });
  });

  it('es idempotente: un segundo aviso no reenvía el WhatsApp', async () => {
    const { svc, messaging } = setup();
    await svc.confirmEpaycoPayment(webhook());
    expect(await svc.confirmEpaycoPayment(webhook())).toEqual({ ok: true, status: 'already_paid' });
    expect(messaging.send).toHaveBeenCalledTimes(1);
  });

  it('rechazada → sin pagar', async () => {
    const { svc, store } = setup();
    expect(await svc.confirmEpaycoPayment(webhook({ codResponse: '2' }))).toEqual({ ok: true, status: 'rejected' });
    expect(store.get(ID)!.paymentStatus).toBe(PaymentStatus.UNPAID);
  });
});

describe('Verificación activa con la API de ePayco (ref_payco del retorno)', () => {
  const approved: PaymentVerification = { status: 'approved', invoice: ID, amount: 65000, testRequest: true, refPayco: 'REF9' };

  it('consulta la referencia y confirma si es de esta reserva y el monto coincide', async () => {
    const { svc, payments, messaging } = setup({ verification: approved });
    const r = await svc.verifyPayment(ID, 'REF9');
    expect(payments.verify).toHaveBeenCalledWith({ invoice: ID, refPayco: 'REF9' });
    expect(r.paymentStatus).toBe(PaymentStatus.PAID);
    expect(r.paymentReference).toBe('REF9');
    expect(messaging.send).toHaveBeenCalledTimes(1);
  });

  it('no guarda la ref_payco de la URL si la pasarela no la confirma', async () => {
    const { svc, store } = setup({ verification: { status: 'pending', invoice: ID } });
    await svc.verifyPayment(ID, 'INVENTADA');
    expect(store.get(ID)!.paymentReference).not.toBe('INVENTADA');
  });

  it('ignora una referencia de OTRA reserva (no se puede reutilizar un pago ajeno)', async () => {
    const { svc } = setup({ verification: { ...approved, invoice: '22222222-2222-4222-8222-222222222222' } });
    expect((await svc.verifyPayment(ID, 'REF9')).paymentStatus).not.toBe(PaymentStatus.PAID);
  });

  it('ignora la referencia si ePayco no devuelve la factura', async () => {
    const { svc } = setup({ verification: { ...approved, invoice: null } });
    expect((await svc.verifyPayment(ID, 'REF9')).paymentStatus).not.toBe(PaymentStatus.PAID);
  });

  it('monto distinto → no confirma', async () => {
    const { svc } = setup({ verification: { ...approved, amount: 100 } });
    expect((await svc.verifyPayment(ID, 'REF9')).paymentStatus).not.toBe(PaymentStatus.PAID);
  });

  it('sin ref_payco también consulta por la factura (intermediario de recaudo)', async () => {
    const { svc, payments } = setup({ verification: approved });
    expect((await svc.verifyPayment(ID)).paymentStatus).toBe(PaymentStatus.PAID);
    expect(payments.verify).toHaveBeenCalledWith({ invoice: ID, refPayco: undefined });
  });

  it('ya pagada → no vuelve a consultar ePayco', async () => {
    const { svc, payments } = setup({ verification: approved });
    await svc.verifyPayment(ID, 'REF9');
    await svc.verifyPayment(ID, 'REF9');
    expect(payments.verify).toHaveBeenCalledTimes(1);
  });
});

describe('Pago en caja (panel)', () => {
  it('queda pagada y confirmada, con recibo y quién la registró, y envía el WhatsApp', async () => {
    const { svc, store, messaging } = setup();
    const r = await svc.registerCashPayment(ID, ' RC-0045 ', 'admin');
    expect(r.paymentStatus).toBe(PaymentStatus.PAID);
    expect(r.status).toBe(ReservationStatus.CONFIRMED);
    expect(r.paymentMethod).toBe('caja');
    expect(r.paymentReference).toBe('RC-0045');
    expect(store.get(ID)!.notes).toContain('Pago en caja (recibo RC-0045) registrado por admin');
    expect(messaging.send).toHaveBeenCalledTimes(1);
  });

  it('no permite registrar dos veces ni pagar una cancelada', async () => {
    const { svc, store } = setup();
    await svc.registerCashPayment(ID, undefined, 'admin');
    await expect(svc.registerCashPayment(ID, undefined, 'admin')).rejects.toThrow(/ya está pagada/);
    const { svc: svc2, store: s2 } = setup();
    s2.get(ID)!.status = ReservationStatus.CANCELLED;
    await expect(svc2.registerCashPayment(ID, undefined, 'admin')).rejects.toThrow(/cancelada/);
    expect(store.size).toBe(1);
  });

  it('la confirmación de pago de una reserva pagada en caja no consulta la pasarela', async () => {
    const { svc, payments } = setup();
    await svc.registerCashPayment(ID, 'RC-1', 'admin');
    const { reservation, gateway } = await svc.checkPayment(ID);
    expect(reservation.paymentMethod).toBe('caja');
    expect(gateway).toBeNull();
    expect(payments.verify).not.toHaveBeenCalled();
  });
});

describe('Doble confirmación (página de confirmación de pago)', () => {
  it('devuelve el resultado de ePayco junto con la reserva confirmada', async () => {
    const { svc } = setup({ verification: { status: 'approved', invoice: ID, amount: 65000, testRequest: true, refPayco: 'R7', responseMessage: 'Aceptada', franchise: 'VISA' } });
    const { reservation, gateway } = await svc.checkPayment(ID, 'R7');
    expect(reservation.paymentStatus).toBe(PaymentStatus.PAID);
    expect(gateway).toMatchObject({ status: 'approved', refPayco: 'R7', responseMessage: 'Aceptada', franchise: 'VISA' });
  });
});
