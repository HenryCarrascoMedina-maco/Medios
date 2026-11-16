import { DAY_MS, HOUR_MS, addDays, dayKey, dayRangeToIso, monthGrid, moveToDay, seriesSchedule, startOfWeek, suggestedTimeOnDay, weekDays } from './dates';

describe('dates', () => {
  it('startOfWeek da el lunes a las 00:00', () => {
    const monday = startOfWeek(new Date(2026, 10, 15, 18, 0)); // domingo 15/11/2026
    expect(dayKey(monday)).toBe('2026-11-09');
    expect(monday.getHours()).toBe(0);
  });

  it('weekDays da de lunes a domingo', () => {
    expect(weekDays(new Date(2026, 10, 11)).map(dayKey)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
  });

  it('monthGrid cubre el mes con semanas completas', () => {
    const grid = monthGrid(new Date(2026, 10, 20)); // noviembre 2026: empieza en domingo
    expect(grid.length % 7).toBe(0);
    expect(dayKey(grid[0])).toBe('2026-10-26');
    expect(dayKey(grid[grid.length - 1])).toBe('2026-12-06');
    expect(grid.some(d => dayKey(d) === '2026-11-30')).toBe(true);
  });

  it('moveToDay conserva la hora', () => {
    const moved = moveToDay(new Date(2026, 10, 5, 18, 45), new Date(2026, 10, 20));
    expect(dayKey(moved)).toBe('2026-11-20');
    expect([moved.getHours(), moved.getMinutes()]).toEqual([18, 45]);
  });

  it('seriesSchedule escalona las fechas', () => {
    const start = new Date(2026, 10, 16, 10, 0);
    expect(seriesSchedule(start, DAY_MS, 3).map(d => d.getTime())).toEqual([start.getTime(), start.getTime() + DAY_MS, start.getTime() + 2 * DAY_MS]);
    expect(seriesSchedule(start, HOUR_MS, 0)).toEqual([]);
  });

  it('dayRangeToIso va del inicio del primer día al inicio del día siguiente al último', () => {
    const range = dayRangeToIso('2026-11-01', '2026-11-03');
    expect(range.from).toBe(new Date(2026, 10, 1).toISOString());
    expect(range.to).toBe(new Date(2026, 10, 4).toISOString());
    expect(dayRangeToIso('', '')).toEqual({ from: null, to: null });
  });

  it('suggestedTimeOnDay: 10:00, o la próxima hora en punto si hoy ya pasó', () => {
    const now = new Date(2026, 10, 15, 9, 0).getTime();
    expect(suggestedTimeOnDay(new Date(2026, 10, 20), now)).toEqual(new Date(2026, 10, 20, 10, 0));
    expect(suggestedTimeOnDay(new Date(2026, 10, 15), now)).toEqual(new Date(2026, 10, 15, 10, 0));
    const late = new Date(2026, 10, 15, 16, 10).getTime();
    expect(suggestedTimeOnDay(new Date(2026, 10, 15), late)).toEqual(new Date(2026, 10, 15, 17, 0));
  });

  it('addDays respeta el cambio de mes', () => {
    expect(dayKey(addDays(new Date(2026, 10, 30), 1))).toBe('2026-12-01');
  });
});
