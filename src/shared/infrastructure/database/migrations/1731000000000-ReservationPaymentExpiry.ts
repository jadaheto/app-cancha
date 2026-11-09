import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Vencimiento de reservas sin pago: plazo para pagar (payment_expires_at) y
 * momento en que se liberó el horario por falta de pago (expired_at).
 * Idempotente (IF NOT EXISTS).
 */
export class ReservationPaymentExpiry1731000000000 implements MigrationInterface {
  name = 'ReservationPaymentExpiry1731000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE reservations ADD COLUMN IF NOT EXISTS payment_expires_at TIMESTAMPTZ NULL`);
    await queryRunner.query(`ALTER TABLE reservations ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ NULL`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_reservations_awaiting_payment ON reservations (payment_status, status, payment_expires_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_reservations_awaiting_payment`);
    await queryRunner.query(`ALTER TABLE reservations DROP COLUMN IF EXISTS expired_at`);
    await queryRunner.query(`ALTER TABLE reservations DROP COLUMN IF EXISTS payment_expires_at`);
  }
}
