import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from '../../../../shared/infrastructure/database/numeric.transformer';

@Entity({ name: 'reservations' })
@Index('idx_reservations_court_start', ['courtId', 'startTime'])
export class ReservationOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'court_id', type: 'uuid' }) courtId!: string;
  @Column({ name: 'user_id', type: 'uuid', nullable: true }) userId!: string | null;

  @Column({ name: 'start_time', type: 'timestamptz' }) startTime!: Date;
  @Column({ name: 'end_time', type: 'timestamptz' }) endTime!: Date;

  @Column({ default: 'pending' }) status!: string;
  @Column({ name: 'payment_status', default: 'unpaid' }) paymentStatus!: string;

  @Column({ name: 'total_amount', type: 'numeric', default: 0, transformer: numericTransformer })
  totalAmount!: number;

  @Column({ type: 'text', nullable: true }) notes!: string | null;
  @Column({ name: 'user_name', type: 'varchar', nullable: true }) userName!: string | null;
  @Column({ name: 'court_name', type: 'varchar', nullable: true }) courtName!: string | null;
  @Column({ name: 'user_phone', type: 'varchar', nullable: true }) userPhone!: string | null;
  @Column({ name: 'user_email', type: 'varchar', nullable: true }) userEmail!: string | null;
  @Column({ name: 'user_category', default: 'D' }) userCategory!: string;

  @Column({ name: 'category_price', type: 'numeric', nullable: true, transformer: numericTransformer })
  categoryPrice!: number | null;

  @Column({ name: 'user_document', type: 'varchar', nullable: true }) userDocument!: string | null;
  @Column({ name: 'verification_code', type: 'varchar', nullable: true }) verificationCode!: string | null;
  @Column({ name: 'verification_expires_at', type: 'timestamp', nullable: true })
  verificationExpiresAt!: Date | null;
  @Column({ name: 'verified_at', type: 'timestamp', nullable: true }) verifiedAt!: Date | null;
  @Column({ name: 'payment_method', type: 'varchar', nullable: true }) paymentMethod!: string | null;
  @Column({ name: 'epayco_reference', type: 'varchar', nullable: true }) paymentReference!: string | null;
  @Column({ name: 'paid_at', type: 'timestamp', nullable: true }) paidAt!: Date | null;
  @Column({ name: 'payment_expires_at', type: 'timestamptz', nullable: true }) paymentExpiresAt!: Date | null;
  @Column({ name: 'expired_at', type: 'timestamptz', nullable: true }) expiredAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
