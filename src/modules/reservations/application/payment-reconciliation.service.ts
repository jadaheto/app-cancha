import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { loadEnv } from '../../../shared/config/env';
import { ReservationsService } from './reservations.service';

/** Ventana (horas) en la que se siguen revisando reservas con pago pendiente. */
const LOOKBACK_HOURS = 48;

/**
 * Conciliación de pagos: el intermediario de recaudo solo avisa a un backend
 * (CLARA), así que appCancha consulta periódicamente las reservas con pago
 * iniciado y sin confirmar. Si el cliente pagó pero cerró el navegador antes de
 * volver, la reserva igual queda pagada y recibe su WhatsApp.
 */
@Injectable()
export class PaymentReconciliationService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PaymentReconciliationService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private readonly reservations: ReservationsService) {}

  onApplicationBootstrap(): void {
    const env = loadEnv();
    const seconds = env.recaudo.reconcileSeconds;
    if (env.providers.payment !== 'recaudo' || !(seconds > 0)) return;
    this.timer = setInterval(() => void this.run(), seconds * 1000);
    this.timer.unref?.();
    this.logger.log(`Conciliación de pagos cada ${seconds} s (reservas pendientes de las últimas ${LOOKBACK_HOURS} h).`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Revisa una vez todas las reservas con pago pendiente. No lanza. */
  async run(): Promise<{ checked: number; paid: number }> {
    if (this.running) return { checked: 0, paid: 0 };
    this.running = true;
    let checked = 0;
    let paid = 0;
    try {
      const pending = await this.reservations.listAwaitingPayment(LOOKBACK_HOURS);
      for (const r of pending) {
        checked++;
        try {
          const updated = await this.reservations.verifyPayment(r.id);
          if (updated.paymentStatus === 'paid') paid++;
        } catch (error) {
          this.logger.warn(`No se pudo verificar el pago de la reserva ${r.id}: ${(error as Error).message}`);
        }
      }
      if (paid > 0) this.logger.log(`Conciliación: ${paid} de ${checked} reservas pendientes quedaron pagadas.`);
    } catch (error) {
      this.logger.warn(`Conciliación de pagos falló: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
    return { checked, paid };
  }
}
