import { describe, expect, it } from 'vitest';
import { dailyBuckets, periodStart, periodStats } from './stats';
import { makeActivity } from '../test-utils';

// 15 октября 2026 — четверг, полдень (по местному времени среды, где идут тесты)
const NOW = new Date(2026, 9, 15, 12, 0, 0);
const at = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h).getTime();

describe('границы периодов', () => {
  it('неделя начинается в понедельник', () => {
    expect(new Date(periodStart('week', NOW))).toEqual(new Date(2026, 9, 12));
  });
  it('воскресенье относится к неделе, начавшейся в предыдущий понедельник', () => {
    expect(new Date(periodStart('week', new Date(2026, 9, 18, 20)))).toEqual(new Date(2026, 9, 12));
  });
  it('в понедельник неделя начинается в тот же день', () => {
    expect(new Date(periodStart('week', new Date(2026, 9, 12, 8)))).toEqual(new Date(2026, 9, 12));
  });
  it('месяц начинается 1-го числа', () => {
    expect(new Date(periodStart('month', NOW))).toEqual(new Date(2026, 9, 1));
  });
});

describe('periodStats', () => {
  const acts = [
    makeActivity('сегодня', { startedAt: at(2026, 10, 15), distanceM: 5000, durationS: 1800, steps: 5000, caloriesKcal: 300, mode: 'run' }),
    makeActivity('понедельник', { startedAt: at(2026, 10, 12), distanceM: 3000, durationS: 2400, steps: 4000, caloriesKcal: 150, mode: 'walk' }),
    makeActivity('прошлая неделя', { startedAt: at(2026, 10, 9), distanceM: 7000, durationS: 3000, steps: 7000, caloriesKcal: 400, mode: 'run' }),
    makeActivity('прошлый месяц', { startedAt: at(2026, 9, 28), distanceM: 9000, durationS: 4000, steps: 9000, caloriesKcal: 500, mode: 'run' }),
    makeActivity('будущее', { startedAt: at(2026, 10, 20), distanceM: 1000 }),
  ];
  it('за неделю', () => {
    expect(periodStats(acts, 'week', NOW)).toEqual({ count: 2, distanceM: 8000, durationS: 4200, steps: 9000, caloriesKcal: 450, walkCount: 1, runCount: 1 });
  });
  it('за месяц', () => {
    const m = periodStats(acts, 'month', NOW);
    expect(m.count).toBe(3);
    expect(m.distanceM).toBe(15_000);
  });
  it('пустая история', () => {
    expect(periodStats([], 'week', NOW)).toEqual({ count: 0, distanceM: 0, durationS: 0, steps: 0, caloriesKcal: 0, walkCount: 0, runCount: 0 });
  });
});

describe('dailyBuckets', () => {
  it('7 дней, последний — сегодня; суммирует по дням', () => {
    const acts = [
      makeActivity('a', { startedAt: at(2026, 10, 15, 8), distanceM: 2000 }),
      makeActivity('b', { startedAt: at(2026, 10, 15, 9), distanceM: 3000 }),
      makeActivity('c', { startedAt: at(2026, 10, 13), distanceM: 1000 }),
      makeActivity('далеко', { startedAt: at(2026, 10, 1), distanceM: 9999 }),
    ];
    const b = dailyBuckets(acts, 7, NOW);
    expect(b).toHaveLength(7);
    expect(b[6]).toMatchObject({ dayStart: new Date(2026, 9, 15).getTime(), distanceM: 5000, count: 2 });
    expect(b[4]).toMatchObject({ distanceM: 1000, count: 1 });
    expect(b.reduce((s, x) => s + x.distanceM, 0)).toBe(6000);
  });
});
