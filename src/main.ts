import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { UPLOADS_PUBLIC_PREFIX } from './modules/media/media.controller';
import { loadEnv } from './shared/config/env';
import { DomainExceptionFilter } from './shared/infrastructure/http/domain-exception.filter';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.setGlobalPrefix('api');
  // Detrás del proxy de Easypanel (Traefik): la IP real del cliente viene en X-Forwarded-For.
  app.set('trust proxy', env.trustProxy);

  // Imágenes subidas desde el panel (fotos de canchas): públicas y cacheables.
  const uploadsDir = resolve(env.uploadsDir);
  mkdirSync(uploadsDir, { recursive: true });
  app.useStaticAssets(uploadsDir, {
    prefix: UPLOADS_PUBLIC_PREFIX,
    index: false,
    dotfiles: 'deny',
    maxAge: '30d',
    immutable: true,
  });
  app.enableCors({ origin: env.corsOrigin, credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new DomainExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('API Reservas de Canchas · Comfasucre')
    .setDescription('API del sistema de reservas (arquitectura hexagonal)')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(env.port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`🚀 API escuchando en http://localhost:${env.port}/api (docs en /api/docs)`);
}

void bootstrap();
