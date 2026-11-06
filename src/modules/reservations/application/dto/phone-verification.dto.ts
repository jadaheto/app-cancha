import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class SendPhoneCodeDto {
  @ApiProperty({ example: '3001234567' })
  @IsString() @Matches(/^\+?[\d\s-]{10,15}$/, { message: 'Celular inválido' })
  phone!: string;
}

export class VerifyPhoneCodeDto extends SendPhoneCodeDto {
  @ApiProperty({ example: '311832' })
  @IsString() @Matches(/^\d{4,8}$/, { message: 'El código debe tener solo números' })
  code!: string;
}
