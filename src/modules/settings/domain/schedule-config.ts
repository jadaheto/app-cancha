import { DomainValidationException } from '../../../shared/domain/exceptions/domain.exception';

/** Horario de atención del portal (horas enteras, zona horaria de Bogotá). */
export interface ScheduleConfig {
  /** Primera hora reservable (0–23). */
  openHour: number;
  /** Hora de cierre (1–24): el último bloque termina a esta hora. */
  closeHour: number;
}

export const SCHEDULE_KEYS = {
  openHour: 'schedule_open_hour',
  closeHour: 'schedule_close_hour',
} as const;

/** Regla de negocio: 0 ≤ apertura < cierre ≤ 24, horas enteras. */
export function assertValidSchedule({ openHour, closeHour }: ScheduleConfig): void {
  if (!Number.isInteger(openHour) || !Number.isInteger(closeHour)) {
    throw new DomainValidationException('Las horas de apertura y cierre deben ser horas enteras');
  }
  if (openHour < 0 || openHour > 23 || closeHour < 1 || closeHour > 24 || openHour >= closeHour) {
    throw new DomainValidationException('La hora de apertura debe ser menor que la de cierre (entre 0 y 24)');
  }
}

/** true si el rango [inicio, fin) (horas decimales del día) cae dentro del horario. */
export function isWithinSchedule(s: ScheduleConfig, startHour: number, endHour: number): boolean {
  return startHour >= s.openHour && endHour <= s.closeHour && startHour < endHour;
}
