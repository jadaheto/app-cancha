import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { RateMatrixDto } from './rate-matrix.dto';

/** Ubicación en el mapa (WGS84). */
export class GeoLocationDto {
  @ApiPropertyOptional({ example: 9.3047 })
  @IsOptional() @IsNumber() @Min(-90) @Max(90)
  lat?: number | null;

  @ApiPropertyOptional({ example: -75.3978 })
  @IsOptional() @IsNumber() @Min(-180) @Max(180)
  lng?: number | null;

  @ApiPropertyOptional({ example: 'Cra. 25 #23-49, Sincelejo' })
  @IsOptional() @IsString() @MaxLength(255)
  address?: string | null;
}

export class CreateCourtDto {
  @ApiProperty({ example: 'Cancha Sintética Principal' })
  @IsString() @MinLength(2) @MaxLength(150)
  name!: string;

  @ApiProperty({ example: 'Fútbol' })
  @IsString() @MinLength(2) @MaxLength(100)
  sportType!: string;

  @ApiPropertyOptional({ enum: ['active', 'inactive', 'maintenance'], default: 'active' })
  @IsOptional() @IsIn(['active', 'inactive', 'maintenance'])
  status?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() courtType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() venueName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() location?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() additionalInfo?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true })
  images?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true })
  attributes?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true })
  venueServices?: string[];

  @ApiPropertyOptional({ description: 'Tarifa por hora base (respaldo)' })
  @IsOptional() @IsNumber() @Min(0)
  hourlyRate?: number;

  @ApiPropertyOptional({ type: GeoLocationDto })
  @IsOptional() @ValidateNested() @Type(() => GeoLocationDto)
  map?: GeoLocationDto;

  @ApiPropertyOptional({ type: RateMatrixDto })
  @IsOptional() @ValidateNested() @Type(() => RateMatrixDto)
  rates?: RateMatrixDto;
}
