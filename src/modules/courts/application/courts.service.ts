import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EntityNotFoundException } from '../../../shared/domain/exceptions/domain.exception';
import { Court, GeoLocation } from '../domain/court';
import { COURT_REPOSITORY, CourtRepository } from '../domain/court.repository';
import { CreateCourtDto, GeoLocationDto } from './dto/create-court.dto';
import { UpdateCourtDto } from './dto/update-court.dto';
import { rateMatrixFromDto } from './court.mapper';

/** Casos de uso de gestión de canchas/recursos. */
@Injectable()
export class CourtsService {
  constructor(@Inject(COURT_REPOSITORY) private readonly repo: CourtRepository) {}

  findAll(): Promise<Court[]> {
    return this.repo.findAll();
  }

  findActive(): Promise<Court[]> {
    return this.repo.findActive();
  }

  async findById(id: string): Promise<Court> {
    const court = await this.repo.findById(id);
    if (!court) throw new EntityNotFoundException('Cancha', id);
    return court;
  }

  create(dto: CreateCourtDto): Promise<Court> {
    const court = new Court({
      id: randomUUID(),
      name: dto.name,
      sportType: dto.sportType,
      status: dto.status ?? 'active',
      courtType: dto.courtType ?? null,
      venueName: dto.venueName ?? null,
      description: dto.description ?? null,
      location: dto.location ?? null,
      address: dto.address ?? null,
      additionalInfo: dto.additionalInfo ?? null,
      images: dto.images ?? [],
      attributes: dto.attributes ?? [],
      venueServices: dto.venueServices ?? [],
      hourlyRate: dto.hourlyRate ?? 0,
      map: toGeo(dto.map),
      rates: rateMatrixFromDto(dto.rates),
      createdAt: new Date(),
    });
    return this.repo.create(court);
  }

  async update(id: string, dto: UpdateCourtDto): Promise<Court> {
    const court = await this.findById(id);

    if (dto.name !== undefined) court.name = dto.name;
    if (dto.sportType !== undefined) court.sportType = dto.sportType;
    if (dto.status !== undefined) court.status = dto.status;
    if (dto.courtType !== undefined) court.courtType = dto.courtType;
    if (dto.venueName !== undefined) court.venueName = dto.venueName;
    if (dto.description !== undefined) court.description = dto.description;
    if (dto.location !== undefined) court.location = dto.location;
    if (dto.address !== undefined) court.address = dto.address;
    if (dto.additionalInfo !== undefined) court.additionalInfo = dto.additionalInfo;
    if (dto.images !== undefined) court.images = dto.images;
    if (dto.attributes !== undefined) court.attributes = dto.attributes;
    if (dto.venueServices !== undefined) court.venueServices = dto.venueServices;
    if (dto.hourlyRate !== undefined) court.hourlyRate = dto.hourlyRate;
    if (dto.map !== undefined) court.map = toGeo(dto.map);
    if (dto.rates !== undefined) court.rates = rateMatrixFromDto(dto.rates);

    return this.repo.update(court);
  }

  async delete(id: string): Promise<void> {
    await this.findById(id);
    await this.repo.delete(id);
  }
}

/** Normaliza la ubicación recibida (campos ausentes → null). */
function toGeo(map?: GeoLocationDto): GeoLocation {
  return {
    lat: typeof map?.lat === 'number' ? map.lat : null,
    lng: typeof map?.lng === 'number' ? map.lng : null,
    address: map?.address?.trim() || null,
  };
}
