/** Utilidades de fechas en hora LOCAL (calendario y programación en serie). Semanas de lunes a domingo. */

export const DAY_MS = 24 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

/** Lunes de la semana de `date`, a las 00:00. */
export function startOfWeek(date: Date): Date {
  const day = startOfDay(date);
  return addDays(day, -((day.getDay() + 6) % 7));
}

/** «2026-11-15» en hora local (clave de día). */
export function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isSameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

/** Los 7 días de la semana de `date`. */
export function weekDays(date: Date): Date[] {
  const start = startOfWeek(date);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Rejilla del mes: semanas completas (lunes a domingo) que cubren el mes de `date`. */
export function monthGrid(date: Date): Date[] {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const start = startOfWeek(first);
  const end = addDays(startOfWeek(last), 7);
  const days: Date[] = [];
  for (let d = start; d < end; d = addDays(d, 1)) days.push(d);
  return days;
}

/** Mismo día de la hora original llevado a otro día (arrastrar en el calendario conserva la hora). */
export function moveToDay(original: Date, day: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), original.getHours(), original.getMinutes(), original.getSeconds());
}

/** Fechas escalonadas: start, start + interval, … (programar en serie). */
export function seriesSchedule(start: Date, intervalMs: number, count: number): Date[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => new Date(start.getTime() + i * intervalMs));
}

/**
 * Rango de días elegido en <input type="date"> («2026-11-01») → instantes UTC ISO para la API:
 * desde el inicio del primer día hasta el inicio del día siguiente al último (hora local).
 */
export function dayRangeToIso(from: string, to: string): { from: string | null; to: string | null } {
  const parse = (value: string) => {
    const [y, m, d] = value.split('-').map(Number);
    return y && m && d ? new Date(y, m - 1, d) : null;
  };
  const start = from ? parse(from) : null;
  const end = to ? parse(to) : null;
  return { from: start?.toISOString() ?? null, to: end ? addDays(end, 1).toISOString() : null };
}

/**
 * Hora propuesta al soltar un video en un día del calendario: las 10:00, o si es hoy y ya pasó,
 * la siguiente hora en punto con al menos 30 minutos de margen.
 */
export function suggestedTimeOnDay(day: Date, now: number): Date {
  const proposal = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 10, 0, 0);
  if (proposal.getTime() > now + 30 * 60_000) return proposal;
  const next = new Date(now + 30 * 60_000);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next;
}
