import { SettingRepository } from '../domain/setting.repository';
import { isWithinSchedule } from '../domain/schedule-config';
import { SettingsService } from './settings.service';

function repo(initial: Record<string, string> = {}): SettingRepository {
  const data = { ...initial };
  return {
    getAll: async () => ({ ...data }),
    get: async (k) => data[k] ?? null,
    setMany: async (v) => { Object.assign(data, v); },
  };
}

describe('SettingsService · horario de atención', () => {
  it('usa los valores por defecto (6–23) si el admin no ha guardado nada', async () => {
    const s = await new SettingsService(repo()).getSchedule();
    expect(s).toEqual({ openHour: 6, closeHour: 23, isDefault: true });
  });

  it('guarda y devuelve el horario editado por el administrador', async () => {
    const svc = new SettingsService(repo());
    await svc.updateSchedule({ openHour: 7, closeHour: 22 });
    expect(await svc.getSchedule()).toEqual({ openHour: 7, closeHour: 22, isDefault: false });
  });

  it('rechaza apertura mayor o igual al cierre', async () => {
    await expect(new SettingsService(repo()).updateSchedule({ openHour: 20, closeHour: 8 })).rejects.toThrow();
  });

  it('restablecer vuelve a los valores por defecto', async () => {
    const svc = new SettingsService(repo({ schedule_open_hour: '8', schedule_close_hour: '20' }));
    expect((await svc.resetSchedule()).isDefault).toBe(true);
  });

  it('isWithinSchedule valida el rango reservado', () => {
    const s = { openHour: 6, closeHour: 23 };
    expect(isWithinSchedule(s, 6, 7)).toBe(true);
    expect(isWithinSchedule(s, 22, 23)).toBe(true);
    expect(isWithinSchedule(s, 5, 6)).toBe(false);
    expect(isWithinSchedule(s, 22, 24)).toBe(false);
  });
});
