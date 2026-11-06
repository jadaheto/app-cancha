import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AuthModule } from './modules/auth/auth.module';
import { CourtsModule } from './modules/courts/courts.module';
import { MediaModule } from './modules/media/media.module';
import { PublicModule } from './modules/public/public.module';
import { ReservationsModule } from './modules/reservations/reservations.module';
import { SettingsModule } from './modules/settings/settings.module';
import { UsersModule } from './modules/users/users.module';
import { DatabaseModule } from './shared/infrastructure/database/database.module';
import { IntegrationsModule } from './shared/infrastructure/integrations.module';
import { SharedModule } from './shared/shared.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SharedModule,
    IntegrationsModule,
    DatabaseModule,
    AuthModule,
    UsersModule,
    CourtsModule,
    MediaModule,
    ReservationsModule,
    SettingsModule,
    AnalyticsModule,
    PublicModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
