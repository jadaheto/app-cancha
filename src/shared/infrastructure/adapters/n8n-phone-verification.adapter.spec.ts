import { isValidResponse } from './n8n-phone-verification.adapter';
import { N8nWhatsappMessagingAdapter } from './n8n-whatsapp-messaging.adapter';

describe('isValidResponse (validar-codigo de n8n)', () => {
  it.each([
    'true', '"valido"', '{"valido":true}', '{"success":true}', '{"status":"approved"}',
    '[{"valido":true}]', '{"data":{"valid":true}}', '{"ok":1}', 'ok',
  ])('acepta %s', (raw) => expect(isValidResponse(raw)).toBe(true));

  it.each([
    '', 'false', '{"valido":false}', '{"success":false,"message":"x"}', '{"status":"rejected"}',
    '[]', '{"message":"Workflow was started"}', 'algo raro', '{"valido":"no"}',
  ])('rechaza %s', (raw) => expect(isValidResponse(raw)).toBe(false));
});

describe('N8nWhatsappMessagingAdapter.sanear', () => {
  it('quita saltos de línea, tabulaciones y espacios repetidos', () => {
    expect(N8nWhatsappMessagingAdapter.sanear('Hola\n\nmundo\t  ok')).toBe('Hola · mundo · ok');
    expect(N8nWhatsappMessagingAdapter.sanear('a    b')).toBe('a b');
  });
});
