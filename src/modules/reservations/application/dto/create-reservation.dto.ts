import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

export class CreateReservationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  courtId!: string;

  @ApiProperty({ example: '2026-11-15', description: 'Fecha (YYYY-MM-DD)' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date debe tener formato YYYY-MM-DD' })
  date!: string;

  @ApiProperty({ example: '18:00', description: 'Hora de inicio (HH:mm)' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime debe tener formato HH:mm' })
  startTime!: string;

  @ApiProperty({ example: '19:00', description: 'Hora de fin (HH:mm)' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'endTime debe tener formato HH:mm' })
  endTime!: string;

  @ApiProperty({ example: 'Juan Pérez' })
  @IsString()
  customerName!: string;

  @ApiPropertyOptional({ example: '3001112233' })
  @IsOptional() @IsString()
  customerPhone?: string;

  @ApiPropertyOptional({ example: 'juan@example.com' })
  @IsOptional() @IsEmail()
  customerEmail?: string;

  @ApiPropertyOptional({ example: '1102233445' })
  @IsOptional() @IsString()
  documentNumber?: string;

  @ApiPropertyOptional({
    enum: ['A', 'B', 'C', 'D'],
    description: 'Si es afiliado y se conoce la categoría, se usa directamente',
  })
  @IsOptional() @IsIn(['A', 'B', 'C', 'D'])
  category?: string;

  @ApiPropertyOptional({ description: 'Marca si el cliente es afiliado a la Caja' })
  @IsOptional() @IsBoolean()
  isAffiliate?: boolean;

  @ApiPropertyOptional({ description: 'Token de verificación del celular (portal público)' })
  @IsOptional() @IsString()
  phoneToken?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Vincular a un usuario existente' })
  @IsOptional() @IsUUID()
  userId?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  notes?: string;
}
