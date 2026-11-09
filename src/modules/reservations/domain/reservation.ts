import {
  ConflictException,
  DomainValidationException,
} from '../../../shared/domain/exceptions/domain.exception';
import { UserCategory } from '../../../shared/domain/value-objects/user-category';

export enum ReservationStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  CANCELLED = 'cancelled',
  COMPLETED = 'completed',
}

export enum PaymentStatus {
  UNPAID = 'unpaid',
  PENDING = 'pending',
  PAID = 'paid',
}

export interface ReservationProps {
  id: string;
  courtId: string;
  userId?: string | null;
  startTime: Date;
  endTime: Date;
  status?: ReservationStatus;
  paymentStatus?: PaymentStatus;
  totalAmount: number;
  notes?: string | null;
  userName?: string | null;
  courtName?: string | null;
  userPhone?: string | null;
  userEmail?: string | null;
  userCategory?: UserCategory;
  categoryPrice?: number | null;
  userDocument?: string | null;
  verificationCode?: string | null;
  verificationExpiresAt?: Date | null;
  verifiedAt?: Date | null;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  paidAt?: Date | null;
  /** Plazo para pagar; vencido sin pago, se libera el horario. */
  paymentExpiresAt?: Date | null;
  /** Cuándo se liberó por falta de pago (null = no vencida). */
  expiredAt?: Date | null;
  createdAt?: Date;
}

/** Entidad de dominio Reservation. Concentra las transiciones de estado válidas. */
export class Reservation {
  readonly id: string;
  courtId: string;
  userId: string | null;
  startTime: Date;
  endTime: Date;
  status: ReservationStatus;
  paymentStatus: PaymentStatus;
  totalAmount: number;
  notes: string | null;
  userName: string | null;
  courtName: string | null;
  userPhone: string | null;
  userEmail: string | null;
  userCategory: UserCategory;
  categoryPrice: number | null;
  userDocument: string | null;
  verificationCode: string | null;
  verificationExpiresAt: Date | null;
  verifiedAt: Date | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  paidAt: Date | null;
  paymentExpiresAt: Date | null;
  expiredAt: Date | null;
  readonly createdAt: Date;

  constructor(props: ReservationProps) {
    if (props.endTime <= props.startTime) {
      throw new DomainValidationException('La hora de fin debe ser posterior a la de inicio');
    }
    this.id = props.id;
    this.courtId = props.courtId;
    this.userId = props.userId ?? null;
    this.startTime = props.startTime;
    this.endTime = props.endTime;
    this.status = props.status ?? ReservationStatus.PENDING;
    this.paymentStatus = props.paymentStatus ?? PaymentStatus.UNPAID;
    this.totalAmount = props.totalAmount;
    this.notes = props.notes ?? null;
    this.userName = props.userName ?? null;
    this.courtName = props.courtName ?? null;
    this.userPhone = props.userPhone ?? null;
    this.userEmail = props.userEmail ?? null;
    this.userCategory = props.userCategory ?? UserCategory.D;
    this.categoryPrice = props.categoryPrice ?? null;
    this.userDocument = props.userDocument ?? null;
    this.verificationCode = props.verificationCode ?? null;
    this.verificationExpiresAt = props.verificationExpiresAt ?? null;
    this.verifiedAt = props.verifiedAt ?? null;
    this.paymentMethod = props.paymentMethod ?? null;
    this.paymentReference = props.paymentReference ?? null;
    this.paidAt = props.paidAt ?? null;
    this.paymentExpiresAt = props.paymentExpiresAt ?? null;
    this.expiredAt = props.expiredAt ?? null;
    this.createdAt = props.createdAt ?? new Date();
  }

  durationHours(): number {
    return (this.endTime.getTime() - this.startTime.getTime()) / 3_600_000;
  }

  setVerification(code: string, expiresAt: Date): void {
    this.verificationCode = code;
    this.verificationExpiresAt = expiresAt;
    this.verifiedAt = null;
  }

  verify(code: string, now: Date = new Date()): void {
    if (!this.verificationCode) {
      throw new ConflictException('Esta reserva no requiere verificación');
    }
    if (this.verificationExpiresAt && this.verificationExpiresAt < now) {
      throw new ConflictException('El código de verificación expiró');
    }
    if (this.verificationCode !== code) {
      throw new ConflictException('Código de verificación incorrecto');
    }
    this.verifiedAt = now;
    this.status = ReservationStatus.CONFIRMED;
  }

  confirm(): void {
    if (this.status === ReservationStatus.CANCELLED) {
      throw new ConflictException('No se puede confirmar una reserva cancelada');
    }
    this.status = ReservationStatus.CONFIRMED;
  }

  cancel(): void {
    if (this.status === ReservationStatus.COMPLETED) {
      throw new ConflictException('No se puede cancelar una reserva completada');
    }
    this.status = ReservationStatus.CANCELLED;
  }

  markPaid(method: string, reference: string | null, paidAt: Date = new Date()): void {
    this.paymentStatus = PaymentStatus.PAID;
    this.paymentMethod = method;
    this.paymentReference = reference;
    this.paidAt = paidAt;
    if (this.status === ReservationStatus.PENDING) {
      this.status = ReservationStatus.CONFIRMED;
    }
  }

  /** true si sigue esperando pago y ya pasó su plazo. */
  isPaymentOverdue(now: Date = new Date()): boolean {
    return (
      this.status === ReservationStatus.PENDING &&
      this.paymentStatus !== PaymentStatus.PAID &&
      this.totalAmount > 0 &&
      this.paymentExpiresAt !== null &&
      this.paymentExpiresAt.getTime() <= now.getTime()
    );
  }

  /** Libera el horario por falta de pago. */
  expire(now: Date = new Date()): void {
    this.status = ReservationStatus.CANCELLED;
    this.expiredAt = now;
    if (this.paymentStatus === PaymentStatus.PENDING) this.paymentStatus = PaymentStatus.UNPAID;
  }
}
