import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class VerifyPaymentDto {
  @ApiPropertyOptional({ description: 'ref_payco que ePayco agrega a la URL de respuesta (opcional)', example: '123456789' })
  @IsOptional() @IsString() @MaxLength(64) @Matches(/^[A-Za-z0-9_-]+$/, { message: 'Referencia de pago inválida' })
  refPayco?: string;
}
