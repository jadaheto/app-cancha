/**
 * Lectura centralizada y tipada de variables de entorno.
 * Única fuente de verdad de configuración para la app y la CLI de TypeORM.
 */
export interface AppEnv {
  nodeEnv: string;
  port: number;
  corsOrigin: string[];
  db: {
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
    ssl: boolean;
    synchronize: boolean;
  };
  jwt: {
    secret: string;
    expiresIn: string;
  };
  seedAdmin: {
    username: string;
    email: string;
    password: string;
    name: string;
  };
  /** Carpeta donde se guardan las imágenes subidas. */
  uploadsDir: string;
  /** Saltos de proxy de confianza para obtener la IP del cliente (Express 'trust proxy'). */
  trustProxy: number;
  schedule: {
    openHour: number;
    closeHour: number;
  };
  providers: {
    payment: string;
    messaging: string;
    documentLookup: string;
  };
  epayco: {
    /** URL pública del checkout (integración personalizada p_*). */
    checkoutUrl: string;
    publicKey: string;
    privateKey: string;
    merchantId: string;
    pKey: string;
    accountId: string;
    testMode: boolean;
    /** URL base pública de este backend para los webhooks de confirmación. */
    confirmationUrl: string;
    responseUrl: string;
  };
  meta: {
    /** Base de la Graph API de Meta (incluye versión). */
    graphUrl: string;
    token: string;
    phoneNumberId: string;
    /** Idioma de las plantillas aprobadas en Meta. */
    templateLanguage: string;
    /** Nombres de las plantillas aprobadas en el WhatsApp Business. */
    templates: {
      verificationCode: string;
      reservationConfirmed: string;
      reservationReminder: string;
    };
  };
  /** Vencimiento de reservas sin pago. */
  paymentHold: {
    /** Minutos para pagar antes de liberar el horario (portal). */
    minutes: number;
    /** Minutos para pagar un link enviado desde el panel. */
    adminMinutes: number;
    /** Espera máxima (desde la creación) si ePayco reporta un pago en proceso (PSE). */
    graceMinutes: number;
    /** Cada cuántos segundos se revisan las reservas vencidas (0 = desactivado). */
    checkSeconds: number;
  };
  /** Intermediario de pagos epayco_reacudo_rd (pagos.comfasucre.co). */
  recaudo: {
    baseUrl: string;
    apiKey: string;
    account: string;
    sourceApp: string;
    /** Forzar modo prueba en el checkout: true/false; null = lo decide el intermediario. */
    testMode: boolean | null;
    timeoutMs: number;
    /** Cada cuántos segundos se revisan las reservas con pago pendiente (0 = desactivado). */
    reconcileSeconds: number;
  };
  /** Webhook de afiliados de n8n (el mismo de CLARA) para la categoría por documento. */
  affiliateLookup: {
    url: string;
    authorization: string;
    timeoutMs: number;
  };
  phoneVerification: {
    /** `n8n` (webhooks enviar/validar-codigo) | `stub` (código en el log, solo local). */
    provider: string;
    sendUrl: string;
    validateUrl: string;
    sendAuthorization: string;
    validateAuthorization: string;
    timeoutMs: number;
    /** Minutos que dura el permiso para reservar tras verificar el celular. */
    tokenTtlMinutes: number;
  };
  whatsapp: {
    /** Webhook de n8n (campaña WiseCX) que entrega el WhatsApp. */
    webhookUrl: string;
    campaignId: string;
    /** Cabecera Authorization completa (p. ej. "Basic xxxx"). */
    authorization: string;
    waitSeconds: number;
    /** Prefijo de país para celulares de 10 dígitos (vacío = enviar tal cual). */
    prefijoPais: string;
    timeoutMs: number;
  };
}

const bool = (v: string | undefined, def = false): boolean =>
  v === undefined ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());

export function loadEnv(): AppEnv {
  return {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: parseInt(process.env.PORT ?? '3000', 10),
    corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:4200')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    db: {
      host: process.env.DB_HOST ?? 'localhost',
      port: parseInt(process.env.DB_PORT ?? '5432', 10),
      username: process.env.DB_USERNAME ?? 'cancha',
      password: process.env.DB_PASSWORD ?? 'cancha_secret',
      database: process.env.DB_DATABASE ?? 'cancha',
      ssl: bool(process.env.DB_SSL),
      synchronize: bool(process.env.DB_SYNCHRONIZE),
    },
    jwt: {
      secret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
      expiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
    },
    seedAdmin: {
      username: process.env.SEED_ADMIN_USERNAME ?? 'admin',
      email: process.env.SEED_ADMIN_EMAIL ?? 'admin@comfasucre.com',
      password: process.env.SEED_ADMIN_PASSWORD ?? 'Comfasucre2025*',
      name: process.env.SEED_ADMIN_NAME ?? 'Administrador Comfasucre',
    },
    uploadsDir: process.env.UPLOADS_DIR ?? './uploads',
    trustProxy: parseInt(process.env.TRUST_PROXY ?? '1', 10),
    schedule: {
      // Horario de atención para la grilla de disponibilidad (horas 0–24, Bogotá).
      openHour: parseInt(process.env.SCHEDULE_OPEN_HOUR ?? '6', 10),
      closeHour: parseInt(process.env.SCHEDULE_CLOSE_HOUR ?? '23', 10),
    },
    providers: {
      payment: process.env.PAYMENT_PROVIDER ?? 'stub',
      messaging: process.env.MESSAGING_PROVIDER ?? 'stub',
      documentLookup: process.env.DOCUMENT_LOOKUP_PROVIDER ?? 'n8n',
    },
    epayco: {
      // Integración personalizada (p_*). checkout.php responde en secure.payco.co.
      checkoutUrl:
        process.env.EPAYCO_CHECKOUT_URL ??
        'https://secure.payco.co/checkout.php',
      // Cuenta "Recreación y Deporte" de Comfasucre.
      publicKey: process.env.EPAYCO_PUBLIC_KEY ?? '',
      privateKey: process.env.EPAYCO_PRIVATE_KEY ?? '',
      merchantId: process.env.EPAYCO_P_CUST_ID ?? '',
      pKey: process.env.EPAYCO_P_KEY ?? '',
      accountId: process.env.EPAYCO_P_ID_ACCOUNT ?? '',
      testMode: bool(process.env.EPAYCO_TEST, true),
      confirmationUrl: process.env.EPAYCO_CONFIRMATION_URL ?? '',
      responseUrl: process.env.EPAYCO_RESPONSE_URL ?? '',
    },
    meta: {
      graphUrl: process.env.META_GRAPH_URL ?? 'https://graph.facebook.com/v21.0',
      token: process.env.META_TOKEN ?? '',
      phoneNumberId: process.env.META_PHONE_NUMBER_ID ?? '',
      templateLanguage: process.env.META_TEMPLATE_LANGUAGE ?? 'es_MX',
      templates: {
        verificationCode: process.env.META_TEMPLATE_CODIGO ?? 'codigo',
        reservationConfirmed: process.env.META_TEMPLATE_RESERVA ?? 'reserva',
        reservationReminder:
          process.env.META_TEMPLATE_RECORDATORIO ?? 'recordatorio_pago',
      },
    },
    paymentHold: {
      minutes: positiveInt(process.env.PAYMENT_HOLD_MINUTES, 10),
      adminMinutes: positiveInt(process.env.PAYMENT_HOLD_MINUTES_ADMIN, positiveInt(process.env.PAYMENT_HOLD_MINUTES, 10)),
      graceMinutes: positiveInt(process.env.PAYMENT_GRACE_MINUTES, 60),
      checkSeconds: nonNegativeInt(process.env.PAYMENT_EXPIRY_CHECK_SECONDS, 60),
    },
    recaudo: {
      baseUrl: (process.env.RECAUDO_BASE_URL ?? 'https://pagos.comfasucre.co').replace(/\/+$/, ''),
      apiKey: process.env.RECAUDO_API_KEY ?? '',
      account: process.env.RECAUDO_ACCOUNT ?? 'recreacion_deporte',
      sourceApp: process.env.RECAUDO_SOURCE_APP ?? 'app-cancha',
      testMode:
        process.env.RECAUDO_TEST_MODE === undefined || process.env.RECAUDO_TEST_MODE === ''
          ? null
          : bool(process.env.RECAUDO_TEST_MODE),
      timeoutMs: parseInt(process.env.RECAUDO_TIMEOUT_MS ?? '20000', 10),
      reconcileSeconds: parseInt(process.env.RECAUDO_RECONCILE_SECONDS ?? '120', 10),
    },
    affiliateLookup: {
      // AFFILIATE_LOOKUP_URL; N8N_WEBHOOK_URL se acepta por compatibilidad con .env anteriores.
      url: process.env.AFFILIATE_LOOKUP_URL || process.env.N8N_WEBHOOK_URL || '',
      authorization: process.env.AFFILIATE_LOOKUP_AUTHORIZATION || process.env.WHATSAPP_AUTHORIZATION || '',
      timeoutMs: parseInt(process.env.AFFILIATE_LOOKUP_TIMEOUT_MS ?? '25000', 10),
    },
    phoneVerification: {
      provider: process.env.PHONE_VERIFICATION_PROVIDER ?? 'n8n',
      sendUrl: process.env.PHONE_VERIFICATION_SEND_URL ?? 'https://n8n.iacomfasucre.com/webhook/enviar-codigo',
      validateUrl: process.env.PHONE_VERIFICATION_VALIDATE_URL ?? 'https://n8n.iacomfasucre.com/webhook/validar-codigo',
      // Todos los webhooks de n8n usan la misma cabecera Basic (WHATSAPP_AUTHORIZATION)
      // salvo que se defina una propia para enviar o validar el código.
      sendAuthorization: process.env.PHONE_VERIFICATION_AUTHORIZATION || process.env.WHATSAPP_AUTHORIZATION || '',
      validateAuthorization:
        process.env.PHONE_VERIFICATION_VALIDATE_AUTHORIZATION ||
        process.env.PHONE_VERIFICATION_AUTHORIZATION ||
        process.env.WHATSAPP_AUTHORIZATION ||
        '',
      timeoutMs: parseInt(process.env.PHONE_VERIFICATION_TIMEOUT_MS ?? '20000', 10),
      tokenTtlMinutes: parseInt(process.env.PHONE_VERIFICATION_TOKEN_TTL_MINUTES ?? '30', 10),
    },
    whatsapp: {
      webhookUrl: process.env.WHATSAPP_WEBHOOK_URL ?? '',
      campaignId: process.env.WHATSAPP_CAMPAIGN_ID ?? '',
      authorization: process.env.WHATSAPP_AUTHORIZATION ?? '',
      waitSeconds: parseInt(process.env.WHATSAPP_WAIT_SECONDS ?? '3', 10),
      prefijoPais: process.env.WHATSAPP_PREFIJO_PAIS ?? '',
      timeoutMs: parseInt(process.env.WHATSAPP_TIMEOUT_MS ?? '20000', 10),
    },
  };
}

/** Entero > 0; vacío o inválido → valor por defecto. */
function positiveInt(value: string | undefined, fallback: number): number {
  const n = parseInt((value ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Entero >= 0 (0 = desactivado); vacío o inválido → valor por defecto. */
function nonNegativeInt(value: string | undefined, fallback: number): number {
  const n = parseInt((value ?? '').trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
