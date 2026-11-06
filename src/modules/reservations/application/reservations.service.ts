import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomInt, randomUUID } from 'crypto';
import { loadEnv } from '../../../shared/config/env';
import {
  ConflictException,
  EntityNotFoundException,
} from '../../../shared/domain/exceptions/domain.exception';
import { isEpaycoConfirmationValid } from '../../../shared/infrastructure/adapters/epayco-signature.util';
import { MESSAGING, MessagingPort } from '../../../shared/domain/ports/messaging.port';
import {
  PAYMENT_GATEWAY,
  PaymentGatewayPort,
} from '../../../shared/domain/ports/payment-gateway.port';
import {
  assertCategory,
  BASE_PRICE_BY_CATEGORY,
  normalizeCategory,
  UserCategory,
} from '../../../shared/domain/value-objects/user-category';
import { CourtsService } from '../../courts/application/courts.service';
import { SettingsService } from '../../settings/application/settings.service';
import { isWithinSchedule } from '../../settings/domain/schedule-config';
import { UsersService } from '../../users/application/users.service';
import { PriceBreakdown, PricingService } from '../domain/pricing.service';
import { TIME_SLOT_LABEL, timeSlotFromHour } from '../../../shared/domain/value-objects/time-slot';
import {
  PaymentStatus,
  Reservation,
  ReservationStatus,
} from '../domain/reservation';
import {
  RESERVATION_REPOSITORY,
  ReservationListFilters,
  ReservationRepository,
} from '../domain/reservation.repository';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { QuoteDto } from './dto/quote.dto';

export interface AvailabilitySlot {
  start: string;
  end: string;
  available: boolean;
  reason: 'reserved' | 'past' | null;
  slotLabel: string;
}

export interface AvailabilityView {
  courtId: string;
  date: string;
  slots: AvailabilitySlot[];
}

/** Datos normalizados de una confirmación (webhook) de ePayco. */
export interface EpaycoConfirmationPayload {
  /** Número de factura enviado al checkout (= id de la reserva). */
  invoice: string;
  refPayco: string;
  transactionId: string;
  amount: string;
  currency: string;
  /** x_cod_response: 1 aceptada, 2 rechazada, 3 pendiente, 4 fallida. */
  codResponse: string;
  signature: string;
  /** x_test_request: 'true' si la transacción fue de prueba. */
  testRequest?: string;
}

/** Datos verificados de un pago, vengan del webhook (firmado) o de la API de ePayco. */
interface VerifiedPayment {
  status: 'pending' | 'approved' | 'rejected';
  amount: number | null;
  testRequest: boolean | null;
  reference: string | null;
  source: 'webhook' | 'consulta';
}

/** Tolerancia (pesos) al comparar el monto pagado con el valor de la reserva. */
const AMOUNT_TOLERANCE = 1;

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    @Inject(RESERVATION_REPOSITORY) private readonly repo: ReservationRepository,
    private readonly courts: CourtsService,
    private readonly users: UsersService,
    @Inject(MESSAGING) private readonly messaging: MessagingPort,
    @Inject(PAYMENT_GATEWAY) private readonly payments: PaymentGatewayPort,
    private readonly settings: SettingsService,
  ) {}

  list(filters?: ReservationListFilters): Promise<Reservation[]> {
    return this.repo.findAll(filters);
  }

  /** Reservas con pago iniciado pero sin confirmar, creadas en los últimos `hours`. */
  async listAwaitingPayment(hours: number): Promise<Reservation[]> {
    const since = Date.now() - hours * 3_600_000;
    const pending = await this.repo.findAll({ paymentStatus: PaymentStatus.PENDING });
    return pending.filter(
      (r) => r.totalAmount > 0 && r.status !== ReservationStatus.CANCELLED && (r.createdAt?.getTime() ?? 0) >= since,
    );
  }

  /** Lista los pagos hechos y confirmados (reservas con pago en estado 'paid'). */
  listPayments(): Promise<Reservation[]> {
    return this.repo.findAll({ paymentStatus: PaymentStatus.PAID });
  }

  async getById(id: string): Promise<Reservation> {
    const reservation = await this.repo.findById(id);
    if (!reservation) throw new EntityNotFoundException('Reserva', id);
    return reservation;
  }

  /** Previsualiza el precio sin crear la reserva. */
  async quote(dto: QuoteDto): Promise<PriceBreakdown & { courtId: string }> {
    const court = await this.courts.findById(dto.courtId);
    const { category } = await this.resolveCategory({
      category: dto.category,
      documentNumber: dto.documentNumber,
      isAffiliate: !!dto.category,
    });
    const { start, end } = this.buildRange(dto.date, dto.startTime, dto.endTime);
    return { courtId: court.id, ...PricingService.calculate(court, category, start, end) };
  }

  /**
   * Grilla de disponibilidad por hora de una cancha en un día: cada bloque de
   * 1 h dentro del horario de atención y si está libre. Los bloques ya pasados
   * (hoy) se marcan como no disponibles. No incluye precio: la tarifa final
   * depende de la categoría del cliente y se obtiene con `quote`.
   */
  async availability(courtId: string, date: string): Promise<AvailabilityView> {
    const court = await this.courts.findById(courtId);
    const { openHour, closeHour } = await this.settings.getSchedule();
    const dayStart = new Date(`${date}T00:00:00-05:00`);
    if (Number.isNaN(dayStart.getTime())) throw new ConflictException('Fecha inválida');
    const dayEnd = new Date(dayStart.getTime() + 24 * 3_600_000);
    const taken = await this.repo.findOverlapping(court.id, dayStart, dayEnd);
    const now = Date.now();

    const slots: AvailabilitySlot[] = [];
    for (let h = openHour; h < closeHour; h++) {
      const start = new Date(dayStart.getTime() + h * 3_600_000);
      const end = new Date(start.getTime() + 3_600_000);
      const busy = taken.some((r) => r.startTime < end && r.endTime > start);
      const past = start.getTime() <= now;
      slots.push({
        start: `${String(h).padStart(2, '0')}:00`,
        end: h + 1 === 24 ? '23:59' : `${String(h + 1).padStart(2, '0')}:00`,
        available: court.isActive() && !busy && !past,
        reason: busy ? 'reserved' : past ? 'past' : null,
        slotLabel: TIME_SLOT_LABEL[timeSlotFromHour(h)],
      });
    }
    return { courtId: court.id, date, slots };
  }

  async create(
    dto: CreateReservationDto,
    opts: { phoneVerified?: boolean; enforceSchedule?: boolean } = {},
  ): Promise<Reservation> {
    const court = await this.courts.findById(dto.courtId);
    const { category, price } = await this.resolveCategory(dto);
    const { start, end } = this.buildRange(dto.date, dto.startTime, dto.endTime);

    // En el portal solo se reserva dentro del horario de atención (el panel no tiene esa restricción).
    if (opts.enforceSchedule) {
      const schedule = await this.settings.getSchedule();
      const toHours = (t: string) => { const [h, m] = t.split(':').map(Number); return h + m / 60; };
      const endHour = dto.endTime === '23:59' ? 24 : toHours(dto.endTime);
      if (!isWithinSchedule(schedule, toHours(dto.startTime), endHour)) {
        throw new ConflictException(
          `El horario de atención es de ${String(schedule.openHour).padStart(2, '0')}:00 a ${String(schedule.closeHour).padStart(2, '0')}:00`,
        );
      }
    }

    await this.assertAvailable(court.id, start, end);

    const breakdown = PricingService.calculate(court, category, start, end);

    const reservation = new Reservation({
      id: randomUUID(),
      courtId: court.id,
      userId: dto.userId ?? null,
      startTime: start,
      endTime: end,
      status: ReservationStatus.PENDING,
      paymentStatus: PaymentStatus.UNPAID,
      totalAmount: breakdown.total,
      notes: dto.notes ?? `Turno: ${breakdown.slotLabel} - Categoría: ${category}`,
      userName: dto.customerName,
      courtName: court.name,
      userPhone: dto.customerPhone ?? null,
      userEmail: dto.customerEmail ?? null,
      userCategory: category,
      categoryPrice: price,
      userDocument: dto.documentNumber ?? null,
      verifiedAt: opts.phoneVerified ? new Date() : null,
    });

    // Reserva sin costo: no pasa por la pasarela, queda confirmada de inmediato
    // y el WhatsApp de confirmación sale ya.
    if (reservation.totalAmount <= 0) {
      reservation.confirm();
      const saved = await this.repo.create(reservation);
      await this.sendReservationConfirmation(saved);
      return saved;
    }

    // Reserva con costo: se crea sin pagar; la confirmación por WhatsApp se
    // envía cuando ePayco confirma el pago (ver confirmEpaycoPayment).
    return this.repo.create(reservation);
  }

  /**
   * Envía por WhatsApp la confirmación de la reserva (plantilla `reserva`) una
   * vez CONFIRMADO el pago. Nunca interrumpe el flujo: si el envío falla, se
   * registra y la reserva queda igual.
   */
  private async sendReservationConfirmation(reservation: Reservation): Promise<void> {
    if (!reservation.userPhone) return;
    let lugar: string | null = null;
    try {
      const court = await this.courts.findById(reservation.courtId);
      lugar = court.venueName ?? court.location;
    } catch {
      /* si no se encuentra la cancha, se usa el nombre por defecto */
    }
    try {
      await this.messaging.send({
        to: reservation.userPhone,
        channel: 'whatsapp',
        template: 'reservation_confirmed',
        variables: {
          nombre: reservation.userName ?? 'Cliente',
          reserva_no: this.reservationNumber(reservation.id),
          fecha: this.formatDate(reservation.startTime),
          hora: `${this.formatTime(reservation.startTime)} - ${this.formatTime(reservation.endTime)}`,
          lugar: lugar?.trim() || 'Comfasucre',
          cancha: reservation.courtName ?? '',
          valor: this.formatCurrency(reservation.totalAmount),
          sin_costo: reservation.totalAmount <= 0 ? 'si' : 'no',
        },
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo enviar la confirmación de la reserva ${reservation.id}: ${(error as Error).message}`,
      );
    }
  }

  /** Número de reserva legible derivado del id. */
  private reservationNumber(id: string): string {
    return `RSV-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  }

  private formatDate(date: Date): string {
    return new Intl.DateTimeFormat('es-CO', {
      timeZone: 'America/Bogota',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  }

  private formatTime(date: Date): string {
    return new Intl.DateTimeFormat('es-CO', {
      timeZone: 'America/Bogota',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  }

  private formatCurrency(amount: number): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(amount);
  }

  async updateStatus(id: string, status: string): Promise<Reservation> {
    const reservation = await this.getById(id);
    switch (status) {
      case ReservationStatus.CONFIRMED:
        reservation.confirm();
        break;
      case ReservationStatus.CANCELLED:
        reservation.cancel();
        break;
      case ReservationStatus.COMPLETED:
        reservation.status = ReservationStatus.COMPLETED;
        break;
      default:
        reservation.status = ReservationStatus.PENDING;
    }
    return this.repo.update(reservation);
  }

  /** Genera y envía un código de verificación por el canal disponible. */
  async sendVerification(id: string): Promise<{ sent: boolean; expiresAt: Date }> {
    const reservation = await this.getById(id);
    if (!reservation.userPhone) {
      throw new ConflictException('La reserva no tiene teléfono para enviar el código');
    }
    const code = randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    reservation.setVerification(code, expiresAt);
    await this.repo.update(reservation);

    await this.messaging.send({
      to: reservation.userPhone,
      channel: 'whatsapp',
      template: 'verification_code',
      variables: { code, name: reservation.userName ?? '' },
    });
    return { sent: true, expiresAt };
  }

  async verify(id: string, code: string): Promise<Reservation> {
    const reservation = await this.getById(id);
    reservation.verify(code);
    return this.repo.update(reservation);
  }

  /** Inicia el pago a través de la pasarela (puerto). */
  async initPayment(id: string, method = 'epayco'): Promise<{
    reference: string;
    checkoutUrl: string;
    status: string;
  }> {
    const reservation = await this.getById(id);
    if (reservation.paymentStatus === PaymentStatus.PAID) {
      throw new ConflictException('La reserva ya está pagada');
    }
    const intent = await this.payments.createIntent({
      reservationId: reservation.id,
      amount: reservation.totalAmount,
      description: `Reserva ${reservation.courtName ?? ''}`,
      customerEmail: reservation.userEmail ?? undefined,
      customerName: reservation.userName ?? undefined,
    });
    reservation.paymentStatus = PaymentStatus.PENDING;
    reservation.paymentMethod = method;
    reservation.paymentReference = intent.reference;
    await this.repo.update(reservation);
    return { reference: intent.reference, checkoutUrl: intent.checkoutUrl, status: intent.status };
  }

  /**
   * Procesa la confirmación (webhook) de ePayco: valida la firma `x_signature`,
   * ubica la reserva por el número de factura (= id de la reserva) y actualiza su
   * estado de pago. Idempotente: si ya estaba pagada, no vuelve a procesar.
   */
  async confirmEpaycoPayment(payload: EpaycoConfirmationPayload): Promise<{
    ok: boolean;
    status: string;
  }> {
    const epayco = loadEnv().epayco;
    const input = {
      refPayco: payload.refPayco,
      transactionId: payload.transactionId,
      amount: payload.amount,
      currency: payload.currency || 'COP',
    };
    if (!isEpaycoConfirmationValid(epayco, payload.signature, input)) {
      this.logger.warn(
        `Confirmación ePayco con firma inválida para factura ${payload.invoice} (ref ${payload.refPayco}).`,
      );
      return { ok: false, status: 'invalid_signature' };
    }

    const reservation = await this.repo.findById(payload.invoice);
    if (!reservation) {
      this.logger.warn(
        `Confirmación ePayco para una factura inexistente: ${payload.invoice}.`,
      );
      return { ok: false, status: 'not_found' };
    }

    if (reservation.paymentStatus === PaymentStatus.PAID) {
      return { ok: true, status: 'already_paid' };
    }

    const cod = Number(payload.codResponse);
    const amount = parseFloat(String(payload.amount).replace(',', '.'));
    const test = (payload.testRequest ?? '').trim().toLowerCase();
    return this.applyPayment(reservation, {
      status: cod === 1 ? 'approved' : cod === 3 ? 'pending' : 'rejected',
      amount: Number.isFinite(amount) ? amount : null,
      testRequest: test === '' ? null : test === 'true' || test === '1',
      reference: payload.refPayco || payload.transactionId || null,
      source: 'webhook',
    });
  }

  /**
   * Verificación ACTIVA del pago en la pasarela (intermediario de recaudo o ePayco):
   * se consulta por la factura (= id de la reserva) y, si el cliente volvió del
   * checkout, con el `ref_payco` que agrega ePayco. No se confía en el navegador:
   * solo se confirma si la transacción es de esta reserva, está aceptada y el
   * monto coincide. Sirve aunque la confirmación de ePayco no haya llegado.
   * Idempotente.
   */
  async verifyPayment(reservationId: string, refPayco?: string): Promise<Reservation> {
    const reservation = await this.getById(reservationId);
    if (reservation.paymentStatus === PaymentStatus.PAID || reservation.totalAmount <= 0) return reservation;
    const ref = (refPayco ?? '').trim();

    const tx = await this.payments.verify({ invoice: reservation.id, refPayco: ref || undefined });
    if (!tx.invoice || tx.invoice !== reservation.id) {
      this.logger.warn(
        `Verificación de pago: la transacción ${ref || tx.refPayco || 'n/d'} no corresponde a la reserva ${reservation.id} (factura ${tx.invoice ?? 'n/d'}).`,
      );
      return reservation;
    }
    await this.applyPayment(reservation, {
      status: tx.status,
      amount: tx.amount ?? null,
      testRequest: tx.testRequest ?? null,
      reference: tx.refPayco || ref || null,
      source: 'consulta',
    });
    return this.getById(reservation.id);
  }

  /**
   * Regla única para aplicar un resultado de pago (webhook o consulta):
   * - Aceptado solo si el monto pagado coincide con el valor de la reserva.
   * - En producción (EPAYCO_TEST=false) se rechazan transacciones de prueba.
   * - Al quedar pagada: confirma la reserva y envía el WhatsApp (una sola vez).
   */
  private async applyPayment(
    reservation: Reservation,
    tx: VerifiedPayment,
  ): Promise<{ ok: boolean; status: string }> {
    if (reservation.paymentStatus === PaymentStatus.PAID) {
      return { ok: true, status: 'already_paid' };
    }
    const label = `Reserva ${reservation.id} (${tx.source}, ref ${tx.reference ?? 'n/d'})`;

    if (tx.status === 'approved') {
      if (tx.amount === null || Math.abs(tx.amount - reservation.totalAmount) > AMOUNT_TOLERANCE) {
        this.logger.warn(
          `${label}: monto pagado ${tx.amount ?? 'n/d'} no coincide con el valor ${reservation.totalAmount}. No se marca como pagada.`,
        );
        return { ok: false, status: 'amount_mismatch' };
      }
      if (!loadEnv().epayco.testMode && tx.testRequest === true) {
        this.logger.warn(`${label}: transacción de PRUEBA recibida en producción. No se marca como pagada.`);
        return { ok: false, status: 'test_transaction' };
      }
      reservation.markPaid('epayco', tx.reference);
      await this.repo.update(reservation);
      this.logger.log(`${label}: marcada como PAGADA.`);
      // El mensaje de WhatsApp sale aquí: cuando el pago queda confirmado.
      await this.sendReservationConfirmation(reservation);
      return { ok: true, status: 'paid' };
    }

    // Pendiente o rechazada: queda sin pagar (pendiente si ePayco aún no decide).
    reservation.paymentReference = tx.reference ?? reservation.paymentReference;
    reservation.paymentStatus = tx.status === 'pending' ? PaymentStatus.PENDING : PaymentStatus.UNPAID;
    await this.repo.update(reservation);
    return { ok: true, status: tx.status === 'pending' ? 'pending' : 'rejected' };
  }

  async delete(id: string): Promise<void> {
    await this.getById(id);
    await this.repo.delete(id);
  }

  // ---- helpers ----

  private async assertAvailable(courtId: string, start: Date, end: Date): Promise<void> {
    const overlapping = await this.repo.findOverlapping(courtId, start, end);
    if (overlapping.length > 0) {
      throw new ConflictException('El horario seleccionado ya está reservado');
    }
  }

  private async resolveCategory(input: {
    category?: string;
    documentNumber?: string;
    isAffiliate?: boolean;
  }): Promise<{ category: UserCategory; price: number }> {
    if (input.category && input.isAffiliate) {
      const category = assertCategory(input.category);
      return { category, price: BASE_PRICE_BY_CATEGORY[category] };
    }
    if (input.documentNumber) {
      const resolution = await this.users.resolveCategoryByDocument(input.documentNumber);
      return { category: resolution.category, price: resolution.price };
    }
    const category = normalizeCategory(input.category);
    return { category, price: BASE_PRICE_BY_CATEGORY[category] };
  }

  /** Construye el rango de fechas en zona horaria de Colombia (UTC-5 fijo). */
  private buildRange(date: string, startTime: string, endTime: string): { start: Date; end: Date } {
    const start = new Date(`${date}T${startTime}:00-05:00`);
    const end = new Date(`${date}T${endTime}:00-05:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new ConflictException('Fecha u hora inválida');
    }
    return { start, end };
  }
}
