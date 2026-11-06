import { N8nDocumentLookupAdapter, parseAffiliateLookup } from './n8n-document-lookup.adapter';

const AUTH = 'Basic dGVzdDp0ZXN0'; // ficticia
const realFetch = global.fetch;
const realEnv = { ...process.env };

afterAll(() => { global.fetch = realFetch; process.env = realEnv; });
beforeEach(() => {
  process.env.AFFILIATE_LOOKUP_URL = 'https://n8n.example/webhook/afiliados';
  process.env.AFFILIATE_LOOKUP_AUTHORIZATION = AUTH;
});

describe('parseAffiliateLookup (respuesta del webhook de afiliados)', () => {
  it('toma la categoría del afiliado ACTIVO', () => {
    const body = JSON.stringify([
      { categoria: 'C', estado_vs_afiliado: 'RETIRADO' },
      { categoria: 'a', estado_vs_afiliado: 'activo' },
    ]);
    expect(parseAffiliateLookup(200, body)).toMatchObject({ found: true, category: 'A' });
  });

  it('sin activo usa la primera categoría válida', () => {
    expect(parseAffiliateLookup(200, '[{"categoria":"B","estado_vs_afiliado":"INACTIVO"}]')).toMatchObject({ category: 'B' });
  });

  it('acepta objeto indexado ({"0":{...}}) como hace n8n', () => {
    expect(parseAffiliateLookup(200, '{"0":{"categoria":"B","estado_vs_afiliado":"ACTIVO"}}')).toMatchObject({ category: 'B' });
  });

  it('no afiliado / sin categoría válida → D', () => {
    expect(parseAffiliateLookup(200, '[]')).toEqual({ found: false, category: 'D', name: undefined });
    expect(parseAffiliateLookup(200, '[{"error":"No es afiliado"}]')).toMatchObject({ found: false, category: 'D' });
    expect(parseAffiliateLookup(200, '[{"categoria":"Z"}]')).toMatchObject({ category: 'D' });
  });

  it('HTTP de error o cuerpo no JSON → inválida (null)', () => {
    expect(parseAffiliateLookup(500, '[]')).toBeNull();
    expect(parseAffiliateLookup(200, 'hola')).toBeNull();
  });
});

describe('N8nDocumentLookupAdapter (contrato con n8n)', () => {
  it('POST x-www-form-urlencoded con numero_identificacion y Authorization', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), init: init! };
      return new Response('[{"categoria":"B","estado_vs_afiliado":"ACTIVO"}]', { status: 200 });
    }) as typeof fetch;
    const r = await new N8nDocumentLookupAdapter().lookup('1.102.233.445');
    expect(r).toMatchObject({ found: true, category: 'B' });
    expect(captured!.url).toBe('https://n8n.example/webhook/afiliados');
    expect(captured!.init.method).toBe('POST');
    expect(captured!.init.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded', Authorization: AUTH });
    expect(captured!.init.body).toBe('numero_identificacion=1102233445');
  });

  it('si n8n no responde o no hay URL, cobra como D sin romper la reserva', async () => {
    global.fetch = jest.fn(async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
    expect(await new N8nDocumentLookupAdapter().lookup('1102233445')).toEqual({ found: false, category: 'D' });
    process.env.AFFILIATE_LOOKUP_URL = '';
    delete process.env.N8N_WEBHOOK_URL;
    expect(await new N8nDocumentLookupAdapter().lookup('1102233445')).toEqual({ found: false, category: 'D' });
  });
});
