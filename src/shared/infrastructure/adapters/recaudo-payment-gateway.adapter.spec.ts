import { RecaudoPaymentGatewayAdapter, pickTransaction } from './recaudo-payment-gateway.adapter';

const KEY = 'clave-ficticia';
const INV = '11111111-1111-4111-8111-111111111111';
const realFetch = global.fetch;
const realEnv = { ...process.env };

beforeEach(() => {
  process.env.RECAUDO_BASE_URL = 'https://pagos.example/';
  process.env.RECAUDO_API_KEY = KEY;
  process.env.RECAUDO_ACCOUNT = 'recreacion_deporte';
  process.env.RECAUDO_SOURCE_APP = 'app-cancha';
  process.env.EPAYCO_RESPONSE_URL = 'https://cancha.example/reserva';
  delete process.env.RECAUDO_TEST_MODE;
});
afterAll(() => { global.fetch = realFetch; process.env = realEnv; });

type Call = { url: string; init: RequestInit };
function mockFetch(handler: (url: string, init: RequestInit) => { status?: number; body: unknown }): Call[] {
  const calls: Call[] = [];
  global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    const r = handler(String(url), init!);
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as typeof fetch;
  return calls;
}

describe('RecaudoPaymentGatewayAdapter · checkout', () => {
  it('crea el checkout en el intermediario con x-api-key, cuenta, factura y URL de respuesta', async () => {
    const calls = mockFetch(() => ({ status: 201, body: { id: 'chk-1', checkoutUrl: 'https://secure.payco.co/checkout.php?x=1', testMode: true } }));
    const r = await new RecaudoPaymentGatewayAdapter().createIntent({
      reservationId: INV, amount: 65000, description: 'Reserva Cancha 1', customerName: 'Ana Gómez', customerEmail: 'ana@example.com',
    });
    expect(r).toEqual({ reference: 'chk-1', checkoutUrl: 'https://secure.payco.co/checkout.php?x=1', status: 'pending' });
    expect(calls[0].url).toBe('https://pagos.example/epayco/checkout');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['x-api-key']).toBe(KEY);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      account: 'recreacion_deporte', sourceApp: 'app-cancha', invoiceNumber: INV, description: 'Reserva Cancha 1',
      amount: 65000, currency: 'COP', extra1: INV, payerName: 'Ana Gómez', payerEmail: 'ana@example.com',
      responseUrl: `https://cancha.example/reserva?invoice=${INV}`,
    });
  });

  it('si el intermediario rechaza el checkout, error claro', async () => {
    mockFetch(() => ({ status: 400, body: { message: 'account inválida' } }));
    await expect(new RecaudoPaymentGatewayAdapter().createIntent({ reservationId: INV, amount: 1, description: 'x' })).rejects.toThrow(/link de pago/);
  });
});

describe('RecaudoPaymentGatewayAdapter · verificación', () => {
  it('con ref_payco primero sincroniza y luego consulta por factura y cuenta', async () => {
    const calls = mockFetch((url) => url.includes('/sync')
      ? { body: { ok: true } }
      : { body: [{ invoiceNumber: INV, status: 'approved', signatureValid: true, amountOk: true, amount: '65000.00', refPayco: 'R1', payload: { x_test_request: 'TRUE' } }] });
    const v = await new RecaudoPaymentGatewayAdapter().verify({ invoice: INV, refPayco: 'R1' });
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      'POST https://pagos.example/epayco/transactions/R1/sync',
      `GET https://pagos.example/epayco/transactions?invoiceNumber=${INV}&account=recreacion_deporte`,
    ]);
    expect(v).toMatchObject({ status: 'approved', invoice: INV, amount: 65000, testRequest: true, refPayco: 'R1', verifiedByGateway: true });
  });

  it('si el intermediario no responde, queda pendiente (no aprueba)', async () => {
    global.fetch = jest.fn(async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
    expect(await new RecaudoPaymentGatewayAdapter().verify({ invoice: INV })).toEqual({ status: 'pending', invoice: INV });
  });
});

describe('pickTransaction', () => {
  const ok = { invoiceNumber: INV, status: 'approved', signatureValid: true, amountOk: true, amount: 65000 };
  it('ignora aprobadas sin firma o monto válidos', () => {
    expect(pickTransaction([{ ...ok, signatureValid: false }], INV).status).toBe('pending');
    expect(pickTransaction([{ ...ok, amountOk: false }], INV).status).toBe('pending');
  });
  it('ignora transacciones de otra factura', () => {
    expect(pickTransaction([{ ...ok, invoiceNumber: 'otra' }], INV).status).toBe('pending');
  });
  it('una aprobada válida gana a una rechazada anterior', () => {
    expect(pickTransaction([{ ...ok, status: 'rejected' }, ok], INV).status).toBe('approved');
  });
  it('solo rechazadas → rechazada', () => {
    expect(pickTransaction([{ ...ok, status: 'rejected' }], INV).status).toBe('rejected');
  });
});
