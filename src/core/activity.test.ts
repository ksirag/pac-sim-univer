import { describe, expect, it } from 'vitest';
import { buildActivity } from './activity';
import { estimateCalories } from './calories';
import { Path } from './geo';
import { createSim, finish, pause } from './simulation';
import { makeParams } from '../test-utils';

const T0 = 1_700_000_000_000;
const END = 1000 / ((6371008.8 * Math.PI) / 180); // широта, дающая ровно 1000 м по меридиану
const route = [0, 0, END, 0];

describe('buildActivity', () => {
  const params = makeParams({ routeLengthM: new Path(route).length });
  it('полностью выполненная активность', () => {
    const st = finish(createSim(params, T0), T0 + 400_000);
    const a = buildActivity(st, route, 70, 'id1');
    expect(a.id).toBe('id1');
    expect(a.endedEarly).toBe(false);
    expect(a.durationS).toBeCloseTo(360, 6);
    expect(a.distanceM).toBeCloseTo(1000, 3);
    expect(a.avgPaceSecPerKm).toBeCloseTo(360, 6);
    expect(a.avgSpeedKmh).toBeCloseTo(10, 6);
    expect(a.steps).toBe(1000);
    expect(a.cadenceSpm).toBeCloseTo(1000 / 6, 6);
    expect(a.caloriesKcal).toBeGreaterThan(0);
    expect(a.coords).toEqual(route);
    expect(a.finishedAt).toBe(T0 + 360_000);
  });
  it('досрочное завершение: часть дистанции и укороченная геометрия', () => {
    const st = finish(createSim(params, T0), T0 + 180_000);
    const a = buildActivity(st, route, 70);
    expect(a.endedEarly).toBe(true);
    expect(a.distanceM).toBeCloseTo(500, 3);
    expect(a.coords.length).toBe(4);
    expect(a.coords[2]).toBeCloseTo(END / 2, 9);
  });
  it('время пауз не входит в длительность', () => {
    let st = createSim(params, T0);
    st = pause(st, T0 + 60_000);
    st = finish(st, T0 + 3_600_000);
    expect(buildActivity(st, route, 70).durationS).toBe(60);
  });
  it('мгновенное завершение даёт нули без NaN', () => {
    const a = buildActivity(finish(createSim(params, T0), T0), route, 70);
    expect(a.durationS).toBe(0);
    expect(a.distanceM).toBe(0);
    expect(a.avgSpeedKmh).toBe(0);
    expect(a.avgPaceSecPerKm).toBe(0);
    expect(a.caloriesKcal).toBe(0);
    expect(Object.values(a).filter((v) => typeof v === 'number').every(Number.isFinite)).toBe(true);
  });
});

describe('estimateCalories', () => {
  it('бег 10 км/ч, 70 кг, час ≈ 700 ккал (оценка)', () => {
    expect(estimateCalories('run', 10, 70, 3600)).toBeGreaterThan(600);
    expect(estimateCalories('run', 10, 70, 3600)).toBeLessThan(800);
  });
  it('ходьба 5 км/ч расходует меньше, чем бег 10 км/ч за то же время', () => {
    expect(estimateCalories('walk', 5, 70, 3600)).toBeLessThan(estimateCalories('run', 10, 70, 3600));
  });
  it('растёт с весом и временем, при плохих данных — 0', () => {
    expect(estimateCalories('walk', 5, 90, 3600)).toBeGreaterThan(estimateCalories('walk', 5, 60, 3600));
    expect(estimateCalories('walk', 5, 70, 7200)).toBeGreaterThan(estimateCalories('walk', 5, 70, 3600));
    expect(estimateCalories('walk', 0, 70, 3600)).toBe(0);
    expect(estimateCalories('walk', 5, NaN, 3600)).toBe(0);
  });
});
