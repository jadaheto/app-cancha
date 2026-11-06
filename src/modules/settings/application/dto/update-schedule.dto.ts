import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

export class UpdateScheduleDto {
  @ApiProperty({ example: 6, description: 'Hora de apertura (0–23)' })
  @IsInt() @Min(0) @Max(23)
  openHour!: number;

  @ApiProperty({ example: 23, description: 'Hora de cierre (1–24)' })
  @IsInt() @Min(1) @Max(24)
  closeHour!: number;
}
