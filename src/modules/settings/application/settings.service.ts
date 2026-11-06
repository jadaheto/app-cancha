import { Inject, Injectable } from '@nestjs/common';
import {
  BRAND_KEY_MAP,
  BrandConfig,
  DEFAULT_BRAND,
} from '../domain/brand-config';
import { loadEnv } from '../../../shared/config/env';
import { SCHEDULE_KEYS, ScheduleConfig, assertValidSchedule } from '../domain/schedule-config';
import { SETTING_REPOSITORY, SettingRepository } from '../domain/setting.repository';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';

/** Casos de uso de configuración (marca y horario de atención). */
@Injectable()
export class SettingsService {
  constructor(@Inject(SETTING_REPOSITORY) private readonly repo: SettingRepository) {}

  /** Devuelve la configuración de marca combinando BD + valores por defecto. */
  async getBrand(): Promise<BrandConfig> {
    const stored = await this.repo.getAll();
    const brand = { ...DEFAULT_BRAND };
    (Object.keys(BRAND_KEY_MAP) as (keyof BrandConfig)[]).forEach((field) => {
      const value = stored[BRAND_KEY_MAP[field]];
      if (value !== undefined && value !== null && value !== '') {
        brand[field] = value;
      }
    });
    return brand;
  }

  async updateBrand(dto: UpdateBrandDto): Promise<BrandConfig> {
    const values: Record<string, string> = {};
    (Object.keys(dto) as (keyof UpdateBrandDto)[]).forEach((field) => {
      const value = dto[field];
      if (value !== undefined && field in BRAND_KEY_MAP) {
        values[BRAND_KEY_MAP[field as keyof BrandConfig]] = value;
      }
    });
    if (Object.keys(values).length > 0) {
      await this.repo.setMany(values);
    }
    return this.getBrand();
  }

  /**
   * Horario de atención: lo guardado por el administrador o, si no hay nada,
   * los valores por defecto de SCHEDULE_OPEN_HOUR / SCHEDULE_CLOSE_HOUR.
   */
  async getSchedule(): Promise<ScheduleConfig & { isDefault: boolean }> {
    const defaults = loadEnv().schedule;
    const stored = await this.repo.getAll();
    const open = parseInt(stored[SCHEDULE_KEYS.openHour] ?? '', 10);
    const close = parseInt(stored[SCHEDULE_KEYS.closeHour] ?? '', 10);
    const candidate = { openHour: open, closeHour: close };
    try {
      assertValidSchedule(candidate);
      return { ...candidate, isDefault: false };
    } catch {
      return { openHour: defaults.openHour, closeHour: defaults.closeHour, isDefault: true };
    }
  }

  async updateSchedule(dto: UpdateScheduleDto): Promise<ScheduleConfig & { isDefault: boolean }> {
    assertValidSchedule(dto);
    await this.repo.setMany({
      [SCHEDULE_KEYS.openHour]: String(dto.openHour),
      [SCHEDULE_KEYS.closeHour]: String(dto.closeHour),
    });
    return this.getSchedule();
  }

  /** Vuelve a los valores por defecto del entorno. */
  async resetSchedule(): Promise<ScheduleConfig & { isDefault: boolean }> {
    await this.repo.setMany({ [SCHEDULE_KEYS.openHour]: '', [SCHEDULE_KEYS.closeHour]: '' });
    return this.getSchedule();
  }
}
