import { Global, Module, Provider } from '@nestjs/common';
import { loadEnv } from '../config/env';
import { DOCUMENT_LOOKUP } from '../domain/ports/document-lookup.port';
import { MESSAGING } from '../domain/ports/messaging.port';
import { PAYMENT_GATEWAY } from '../domain/ports/payment-gateway.port';
import { PHONE_VERIFICATION } from '../domain/ports/phone-verification.port';
import { N8nPhoneVerificationAdapter } from './adapters/n8n-phone-verification.adapter';
import { StubPhoneVerificationAdapter } from './adapters/stub-phone-verification.adapter';
import { EpaycoPaymentGatewayAdapter } from './adapters/epayco-payment-gateway.adapter';
import { MetaMessagingAdapter } from './adapters/meta-messaging.adapter';
import { N8nWhatsappMessagingAdapter } from './adapters/n8n-whatsapp-messaging.adapter';
import { StubDocumentLookupAdapter } from './adapters/stub-document-lookup.adapter';
import { StubMessagingAdapter } from './adapters/stub-messaging.adapter';
import { StubPaymentGatewayAdapter } from './adapters/stub-payment-gateway.adapter';

const env = loadEnv();

/**
 * Selecciona el adaptador de cada puerto según el proveedor configurado en .env.
 * Pagos: `epayco` (real, cuenta Recreación y Deporte) o `stub`.
 * Mensajería: `n8n` (webhook WiseCX, intermediario) | `meta` (Cloud API directa) | `stub`.
 * El dominio no cambia: solo se intercambia la implementación del puerto.
 */
const paymentProvider: Provider = {
  provide: PAYMENT_GATEWAY,
  useClass:
    env.providers.payment === 'epayco'
      ? EpaycoPaymentGatewayAdapter
      : StubPaymentGatewayAdapter,
};
const messagingProvider: Provider = {
  provide: MESSAGING,
  useClass:
    env.providers.messaging === 'n8n'
      ? N8nWhatsappMessagingAdapter
      : env.providers.messaging === 'meta'
        ? MetaMessagingAdapter
        : StubMessagingAdapter,
};
const documentLookupProvider: Provider = {
  provide: DOCUMENT_LOOKUP,
  useClass: StubDocumentLookupAdapter,
};

const phoneVerificationProvider: Provider = {
  provide: PHONE_VERIFICATION,
  useClass:
    env.phoneVerification.provider === 'stub'
      ? StubPhoneVerificationAdapter
      : N8nPhoneVerificationAdapter,
};

@Global()
@Module({
  providers: [paymentProvider, messagingProvider, documentLookupProvider, phoneVerificationProvider],
  exports: [PAYMENT_GATEWAY, MESSAGING, DOCUMENT_LOOKUP, PHONE_VERIFICATION],
})
export class IntegrationsModule {
  constructor() {
    const { payment, messaging, documentLookup } = env.providers;
    const unimplemented: string[] = [];
    if (!['stub', 'epayco'].includes(payment)) unimplemented.push(`payment=${payment}`);
    if (!['stub', 'meta', 'n8n'].includes(messaging)) unimplemented.push(`messaging=${messaging}`);
    if (documentLookup !== 'stub') unimplemented.push(`documentLookup=${documentLookup}`);
    if (unimplemented.length > 0) {
      // Aviso para proveedores solicitados que aún no tienen adaptador real.
      // eslint-disable-next-line no-console
      console.warn(
        `[Integraciones] Sin adaptador para ${unimplemented.join(', ')}; usando stub en esos puertos.`,
      );
    }
  }
}
