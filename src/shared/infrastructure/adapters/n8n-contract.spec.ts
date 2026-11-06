/**
 * Pruebas de contrato con los webhooks de n8n de Comfasucre. Simulan `fetch` y
 * comprueban que cada petición tiene la misma forma que los ejemplos entregados (PHP/cURL):
 *  - enviar-codigo:    POST multipart { phone }                                       + Authorization
 *  - validar-codigo:   POST multipart { phone, codigo }                               + Authorization
 *  - campaña WhatsApp: POST multipart { telefonos, campaign_id, mensaje, wait_seconds } + Authorization
 * La credencial es ficticia: solo se verifica que la cabecera configurada se envía tal cual.
 */
import { N8nPhoneVerificationAdapter } from './n8n-phone-verification.adapter';
import { N8nWhatsappMessagingAdapter } from './n8n-whatsapp-messaging.adapter';

const AUTH = 'Basic dGVzdDp0ZXN0'; // test:test (ficticia)

interface Captured { url: string; method: string; headers: Record<string, string>; fields: Record<string, string> }

function mockFetch(responses: Array<{ status?: number; body?: string }>): Captured[] {
  const calls: Captured[] = [];
  let i = 0;
  global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const fields: Record<string, string> = {};
    (init?.body as FormData).forEach((v, k) => { fields[k] = String(v); });
    calls.push({ url: String(url), method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string>, fields });
    const r = responses[Math.min(i++, responses.length - 1)];
    return new Response(r.body ?? '', { status: r.status ?? 200 });
  }) as typeof fetch;
  return calls;
}

const realFetch = global.fetch;
const realEnv = { ...process.env };

beforeEach(() => {
  process.env.WHATSAPP_WEBHOOK_URL = 'https://n8n.iacomfasucre.com/webhook/wisecx-campana-whatsapp';
  process.env.WHATSAPP_CAMPAIGN_ID = '0190848';
  process.env.WHATSAPP_AUTHORIZATION = AUTH;
  process.env.WHATSAPP_WAIT_SECONDS = '3';
  process.env.WHATSAPP_PREFIJO_PAIS = '';
  delete process.env.PHONE_VERIFICATION_SEND_URL;
  delete process.env.PHONE_VERIFICATION_VALIDATE_URL;
  delete process.env.PHONE_VERIFICATION_AUTHORIZATION;
  delete process.env.PHONE_VERIFICATION_VALIDATE_AUTHORIZATION;
});
afterAll(() => { global.fetch = realFetch; process.env = realEnv; });

describe('enviar-codigo', () => {
  it('envía phone por multipart con la cabecera Authorization configurada', async () => {
    const calls = mockFetch([{ body: '{"ok":true}' }]);
    await new N8nPhoneVerificationAdapter().sendCode('3015894392');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      url: 'https://n8n.iacomfasucre.com/webhook/enviar-codigo',
      method: 'POST',
      headers: { Authorization: AUTH },
      fields: { phone: '3015894392' },
    });
  });

  it('falla si n8n responde error HTTP o un cuerpo de fallo explícito', async () => {
    mockFetch([{ status: 500, body: 'boom' }]);
    await expect(new N8nPhoneVerificationAdapter().sendCode('3015894392')).rejects.toThrow();
    mockFetch([{ body: '{"success":false,"message":"número inválido"}' }]);
    await expect(new N8nPhoneVerificationAdapter().sendCode('3015894392')).rejects.toThrow();
  });

  it('un 200 con cuerpo vacío o sin bandera se toma como enviado', async () => {
    mockFetch([{ body: '' }]);
    await expect(new N8nPhoneVerificationAdapter().sendCode('3015894392')).resolves.toBeUndefined();
    mockFetch([{ body: '{"message":"Workflow was started"}' }]);
    await expect(new N8nPhoneVerificationAdapter().sendCode('3015894392')).resolves.toBeUndefined();
  });

  it('si n8n no responde, error claro (sin colgar la petición)', async () => {
    global.fetch = jest.fn(async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); }) as typeof fetch;
    await expect(new N8nPhoneVerificationAdapter().sendCode('3015894392')).rejects.toThrow(/no responde/);
  });
});

describe('validar-codigo', () => {
  it('envía phone y codigo por multipart, con la misma cabecera Authorization', async () => {
    const calls = mockFetch([{ body: '{"valido":true}' }]);
    const ok = await new N8nPhoneVerificationAdapter().checkCode('3015894392', '311832');
    expect(ok).toBe(true);
    expect(calls[0]).toEqual({
      url: 'https://n8n.iacomfasucre.com/webhook/validar-codigo',
      method: 'POST',
      headers: { Authorization: AUTH },
      fields: { phone: '3015894392', codigo: '311832' },
    });
  });

  it('código incorrecto → false; n8n caído → error', async () => {
    mockFetch([{ body: '{"valido":false}' }]);
    expect(await new N8nPhoneVerificationAdapter().checkCode('3015894392', '000000')).toBe(false);
    mockFetch([{ status: 404, body: '' }]);
    expect(await new N8nPhoneVerificationAdapter().checkCode('3015894392', '000000')).toBe(false);
    mockFetch([{ status: 502, body: '' }]);
    await expect(new N8nPhoneVerificationAdapter().checkCode('3015894392', '000000')).rejects.toThrow();
  });
});

describe('mensaje de confirmación (campaña WhatsApp)', () => {
  const variables = {
    nombre: 'Ana Gómez', reserva_no: 'RSV-1A2B3C4D', fecha: '08/11/2026', hora: '18:00 - 19:00',
    lugar: 'Complejo Deportivo Comfasucre', cancha: 'Cancha Sintética Principal', valor: '$ 65.000', sin_costo: 'no',
  };

  it('envía telefonos, campaign_id, mensaje y wait_seconds con Authorization', async () => {
    const calls = mockFetch([{ body: '{"aceptado":true,"execution_id":"484977"}' }]);
    const r = await new N8nWhatsappMessagingAdapter().send({
      to: '3015894392', channel: 'whatsapp', template: 'reservation_confirmed', variables,
    });
    expect(r).toEqual({ delivered: true, providerMessageId: '484977' });
    const c = calls[0];
    expect(c.url).toBe('https://n8n.iacomfasucre.com/webhook/wisecx-campana-whatsapp');
    expect(c.method).toBe('POST');
    expect(c.headers).toEqual({ Authorization: AUTH });
    expect(Object.keys(c.fields).sort()).toEqual(['campaign_id', 'mensaje', 'telefonos', 'wait_seconds']);
    expect(c.fields.telefonos).toBe('3015894392');
    expect(c.fields.campaign_id).toBe('0190848');
    expect(c.fields.wait_seconds).toBe('3');
  });

  it('el mensaje va en una sola línea, sin saltos ni tabulaciones', async () => {
    const calls = mockFetch([{ body: '{}' }]);
    await new N8nWhatsappMessagingAdapter().send({ to: '3015894392', channel: 'whatsapp', template: 'reservation_confirmed', variables });
    const msg = calls[0].fields.mensaje;
    expect(msg).not.toMatch(/[\r\n\t]/);
    expect(msg).not.toMatch(/\s{2,}/);
    expect(msg).toBe(
      '¡Hola Ana Gómez! Tu pago fue confirmado y tu reserva RSV-1A2B3C4D quedó confirmada para el 08/11/2026 ' +
      'de 18:00 - 19:00 en Cancha Sintética Principal (Complejo Deportivo Comfasucre). Valor pagado: $ 65.000. ' +
      'Gracias por reservar con Comfasucre.',
    );
  });

  it('reserva sin costo: no menciona pago', async () => {
    const calls = mockFetch([{ body: '{}' }]);
    await new N8nWhatsappMessagingAdapter().send({
      to: '3015894392', channel: 'whatsapp', template: 'reservation_confirmed', variables: { ...variables, sin_costo: 'si', valor: '$ 0' },
    });
    expect(calls[0].fields.mensaje).toMatch(/^¡Hola Ana Gómez! Tu reserva RSV-1A2B3C4D quedó confirmada .* Reserva sin costo\. Gracias/);
  });

  it('si n8n falla, no rompe la reserva (delivered: false)', async () => {
    mockFetch([{ status: 500, body: 'error' }]);
    const r = await new N8nWhatsappMessagingAdapter().send({ to: '3015894392', channel: 'whatsapp', template: 'reservation_confirmed', variables });
    expect(r.delivered).toBe(false);
  });
});

describe('describeFetchError', () => {
  it('muestra la causa real de "fetch failed"', () => {
    const { describeFetchError } = jest.requireActual('./n8n-phone-verification.adapter');
    const e = Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT', message: 'Connect Timeout Error' } });
    expect(describeFetchError(e)).toBe('fetch failed · UND_ERR_CONNECT_TIMEOUT (no se pudo conectar en 10 s: posible firewall o IP no autorizada) · Connect Timeout Error');
  });
});

describe('parseEpaycoValidation (API de validación de ePayco)', () => {
  it('extrae estado, factura, monto y modo prueba', () => {
    const { parseEpaycoValidation } = jest.requireActual('./epayco-payment-gateway.adapter');
    expect(parseEpaycoValidation({
      x_cod_response: 1, x_response: 'Aceptada', x_id_invoice: 'abc', x_amount: '65000', x_currency_code: 'COP',
      x_test_request: 'TRUE', x_ref_payco: '999', x_transaction_id: 't1',
    })).toEqual({ status: 'approved', invoice: 'abc', amount: 65000, currency: 'COP', testRequest: true, refPayco: '999', transactionId: 't1', responseMessage: 'Aceptada', franchise: null, transactionDate: null });
    expect(parseEpaycoValidation({ x_cod_response: '2', x_response: 'Rechazada' }).status).toBe('rejected');
    expect(parseEpaycoValidation({ x_cod_response: '3', x_response: 'Pendiente' }).status).toBe('pending');
  });
});
