import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { CreateReservationDto } from './create-reservation.dto';

export const ADMIN_PAYMENT_METHODS = ['caja', 'epayco'] as const;
export type AdminPaymentMethod = (typeof ADMIN_PAYMENT_METHODS)[number];

/** Reserva creada desde el panel: se paga en caja o con link de ePayco. */
export class AdminCreateReservationDto extends CreateReservationDto {
  @ApiProperty({ enum: ADMIN_PAYMENT_METHODS, description: 'caja = pagada en caja (queda pagada); epayco = se genera el link de pago' })
  @IsIn(ADMIN_PAYMENT_METHODS)
  paymentMethod!: AdminPaymentMethod;

  @ApiPropertyOptional({ description: 'N.º de recibo o comprobante de caja', example: 'RC-004512' })
  @IsOptional() @IsString() @MaxLength(80)
  cashReference?: string;
}

/** Registrar en caja el pago de una reserva existente. */
export class CashPaymentDto {
  @ApiPropertyOptional({ description: 'N.º de recibo o comprobante de caja', example: 'RC-004512' })
  @IsOptional() @IsString() @MaxLength(80)
  reference?: string;
}
