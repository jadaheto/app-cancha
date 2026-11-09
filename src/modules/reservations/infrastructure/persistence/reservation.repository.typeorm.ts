import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { normalizeCategory } from '../../../../shared/domain/value-objects/user-category';
import {
  PaymentStatus,
  Reservation,
  ReservationStatus,
} from '../../domain/reservation';
import {
  ReservationListFilters,
  ReservationRepository,
} from '../../domain/reservation.repository';
import { ReservationOrmEntity } from './reservation.orm-entity';

@Injectable()
export class TypeOrmReservationRepository implements ReservationRepository {
  constructor(
    @InjectRepository(ReservationOrmEntity)
    private readonly repo: Repository<ReservationOrmEntity>,
  ) {}

  async findAll(filters?: ReservationListFilters): Promise<Reservation[]> {
    const qb = this.repo.createQueryBuilder('r');
    if (filters?.courtId) qb.andWhere('r.court_id = :courtId', { courtId: filters.courtId });
    if (filters?.status) qb.andWhere('r.status = :status', { status: filters.status });
    if (filters?.paymentStatus) {
      qb.andWhere('r.payment_status = :paymentStatus', { paymentStatus: filters.paymentStatus });
    }
    if (filters?.date) {
      qb.andWhere("(r.start_time AT TIME ZONE 'America/Bogota')::date = :date", {
        date: filters.date,
      });
    }
    qb.orderBy('r.start_time', 'DESC');
    const rows = await qb.getMany();
    return rows.map((r) => this.toDomain(r));
  }

  async findById(id: string): Promise<Reservation | null> {
    const row = await this.repo.findOne({ where: { id } });
    return row ? this.toDomain(row) : null;
  }

  async findOverlapping(courtId: string, start: Date, end: Date): Promise<Reservation[]> {
    const rows = await this.repo
      .createQueryBuilder('r')
      .where('r.court_id = :courtId', { courtId })
      .andWhere('r.status != :cancelled', { cancelled: ReservationStatus.CANCELLED })
      .andWhere(
        new Brackets((qb) => {
          qb.where('r.start_time < :end AND r.end_time > :start', { start, end });
        }),
      )
      .getMany();
    return rows.map((r) => this.toDomain(r));
  }

  async create(reservation: Reservation): Promise<Reservation> {
    const saved = await this.repo.save(this.toOrm(reservation));
    return this.toDomain(saved);
  }

  async update(reservation: Reservation): Promise<Reservation> {
    await this.repo.save(this.toOrm(reservation));
    const saved = await this.repo.findOneOrFail({ where: { id: reservation.id } });
    return this.toDomain(saved);
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete(id);
  }

  private toDomain(r: ReservationOrmEntity): Reservation {
    return new Reservation({
      id: r.id,
      courtId: r.courtId,
      userId: r.userId,
      startTime: r.startTime,
      endTime: r.endTime,
      status: r.status as ReservationStatus,
      paymentStatus: r.paymentStatus as PaymentStatus,
      totalAmount: r.totalAmount,
      notes: r.notes,
      userName: r.userName,
      courtName: r.courtName,
      userPhone: r.userPhone,
      userEmail: r.userEmail,
      userCategory: normalizeCategory(r.userCategory),
      categoryPrice: r.categoryPrice,
      userDocument: r.userDocument,
      verificationCode: r.verificationCode,
      verificationExpiresAt: r.verificationExpiresAt,
      verifiedAt: r.verifiedAt,
      paymentMethod: r.paymentMethod,
      paymentReference: r.paymentReference,
      paidAt: r.paidAt,
      paymentExpiresAt: r.paymentExpiresAt,
      expiredAt: r.expiredAt,
      createdAt: r.createdAt,
    });
  }

  private toOrm(r: Reservation): ReservationOrmEntity {
    const entity = new ReservationOrmEntity();
    entity.id = r.id;
    entity.courtId = r.courtId;
    entity.userId = r.userId;
    entity.startTime = r.startTime;
    entity.endTime = r.endTime;
    entity.status = r.status;
    entity.paymentStatus = r.paymentStatus;
    entity.totalAmount = r.totalAmount;
    entity.notes = r.notes;
    entity.userName = r.userName;
    entity.courtName = r.courtName;
    entity.userPhone = r.userPhone;
    entity.userEmail = r.userEmail;
    entity.userCategory = r.userCategory;
    entity.categoryPrice = r.categoryPrice;
    entity.userDocument = r.userDocument;
    entity.verificationCode = r.verificationCode;
    entity.verificationExpiresAt = r.verificationExpiresAt;
    entity.verifiedAt = r.verifiedAt;
    entity.paymentMethod = r.paymentMethod;
    entity.paymentReference = r.paymentReference;
    entity.paidAt = r.paidAt;
    entity.paymentExpiresAt = r.paymentExpiresAt;
    entity.expiredAt = r.expiredAt;
    return entity;
  }
}
