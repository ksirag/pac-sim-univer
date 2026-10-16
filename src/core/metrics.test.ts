import { describe, expect, it } from 'vitest';
import { HARD, defaultStepLength, paceToSpeedKmh, progressMetrics, solvePlan, speedKmhToPace, type PlanInput } from './metrics';

const base: PlanInput = { mode: 'run', derive: 'duration', stepMode: 'length', stepLengthM: 1 };

function ok(input: PlanInput) {
  const r = solvePlan(input);
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.plan;
}

describe('темп и скорость', () => {
  it('преобразуются друг в друга', () => {
    expect(paceToSpeedKmh(360)).toBeCloseTo(10, 9);
    expect(speedKmhToPace(12)).toBeCloseTo(300, 9);
    expect(speedKmhToPace(paceToSpeedKmh(437))).toBeCloseTo(437, 9);
  });
});

describe('solvePlan: согласование величин', () => {
  it('вычисляет длительность: 5 км при темпе 6:00/км = 30 минут', () => {
    const p = ok({ ...base, derive: 'duration', distanceM: 5000, paceSecPerKm: 360 });
    expect(p.durationS).toBeCloseTo(1800, 6);
    expect(p.speedKmh).toBeCloseTo(10, 6);
  });
  it('вычисляет темп: 10 км за 50 минут = 5:00/км, 12 км/ч', () => {
    const p = ok({ ...base, derive: 'pace', distanceM: 10_000, durationS: 3000 });
    expect(p.paceSecPerKm).toBeCloseTo(300, 6);
    expect(p.speedKmh).toBeCloseTo(12, 6);
  });
  it('вычисляет дистанцию: 1 час при темпе 6:00/км = 10 км', () => {
    const p = ok({ ...base, derive: 'distance', durationS: 3600, paceSecPerKm: 360 });
    expect(p.distanceM).toBeCloseTo(10_000, 6);
  });
  it('величины всегда согласованы: дистанция = скорость × время', () => {
    const cases: PlanInput[] = [
      { ...base, derive: 'duration', distanceM: 3210, paceSecPerKm: 401 },
      { ...base, derive: 'pace', distanceM: 7777, durationS: 2345 },
      { ...base, derive: 'distance', durationS: 1234, paceSecPerKm: 333 },
    ];
    for (const c of cases) {
      const p = ok(c);
      expect(p.distanceM / 1000).toBeCloseTo(p.speedKmh * (p.durationS / 3600), 6);
      expect(p.paceSecPerKm).toBeCloseTo(p.durationS / (p.distanceM / 1000), 6);
    }
  });
  it('лишнее значение вычисляемой величины игнорируется (противоречий нет)', () => {
    const p = ok({ ...base, derive: 'duration', distanceM: 5000, paceSecPerKm: 360, durationS: 1 });
    expect(p.durationS).toBeCloseTo(1800, 6);
  });
});

describe('solvePlan: ошибки ввода', () => {
  it('нулевые, отрицательные и нечисловые значения', () => {
    expect(solvePlan({ ...base, distanceM: 0, paceSecPerKm: 360 }).ok).toBe(false);
    expect(solvePlan({ ...base, distanceM: -5, paceSecPerKm: 360 }).ok).toBe(false);
    expect(solvePlan({ ...base, distanceM: 5000, paceSecPerKm: NaN }).ok).toBe(false);
    expect(solvePlan({ ...base, derive: 'pace', distanceM: 5000 }).ok).toBe(false);
  });
  it('слишком маленькая и слишком большая дистанция', () => {
    expect(solvePlan({ ...base, distanceM: HARD.minDistanceM - 1, paceSecPerKm: 360 }).ok).toBe(false);
    expect(solvePlan({ ...base, distanceM: HARD.maxDistanceM + 1, paceSecPerKm: 360 }).ok).toBe(false);
  });
  it('длительность свыше 24 часов', () => {
    const r = solvePlan({ ...base, derive: 'pace', distanceM: 100_000, durationS: 25 * 3600 });
    expect(r.ok).toBe(false);
  });
  it('нереальная скорость быстрее 40 км/ч', () => {
    expect(solvePlan({ ...base, derive: 'duration', distanceM: 1000, paceSecPerKm: 60 }).ok).toBe(false);
  });
  it('ошибка возвращает понятные тексты', () => {
    const r = solvePlan({ ...base, distanceM: 0, paceSecPerKm: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.every((e) => /[А-Яа-я]/.test(e))).toBe(true);
  });
});

describe('solvePlan: шаги', () => {
  it('по длине шага: 3000 м при шаге 0,75 м = 4000 шагов', () => {
    const p = ok({ ...base, mode: 'walk', derive: 'duration', distanceM: 3000, paceSecPerKm: 720, stepLengthM: 0.75 });
    expect(p.steps).toBe(4000);
  });
  it('по количеству шагов: 5000 шагов на 3,5 км → шаг 0,7 м', () => {
    const p = ok({ ...base, mode: 'walk', derive: 'duration', distanceM: 3500, paceSecPerKm: 720, stepMode: 'count', steps: 5000 });
    expect(p.stepLengthM).toBeCloseTo(0.7, 9);
    expect(p.steps).toBe(5000);
  });
  it('частота шагов = шаги / минуты', () => {
    const p = ok({ ...base, mode: 'walk', derive: 'duration', distanceM: 3000, paceSecPerKm: 720, stepLengthM: 0.75 });
    expect(p.cadenceSpm).toBeCloseTo(4000 / (p.durationS / 60), 6);
  });
  it('нулевая длина шага и ноль шагов — ошибка', () => {
    expect(solvePlan({ ...base, distanceM: 1000, paceSecPerKm: 360, stepLengthM: 0 }).ok).toBe(false);
    expect(solvePlan({ ...base, distanceM: 1000, paceSecPerKm: 360, stepMode: 'count', steps: 0 }).ok).toBe(false);
  });
  it('невозможная длина шага (> 3 м) — ошибка, необычная — предупреждение', () => {
    expect(solvePlan({ ...base, distanceM: 1000, paceSecPerKm: 360, stepLengthM: 3.5 }).ok).toBe(false);
    const p = ok({ ...base, mode: 'walk', derive: 'duration', distanceM: 1000, paceSecPerKm: 720, stepLengthM: 1.5 });
    expect(p.warnings.some((w) => /длина шага/i.test(w))).toBe(true);
  });
  it('defaultStepLength зависит от роста и режима', () => {
    expect(defaultStepLength('walk', 172)).toBeCloseTo(0.71, 2);
    expect(defaultStepLength('run', 172)).toBeGreaterThan(defaultStepLength('walk', 172));
    expect(defaultStepLength('walk', 5)).toBeCloseTo(0.71, 2); // некорректный рост → значение по умолчанию
  });
});

describe('solvePlan: предупреждения о режиме', () => {
  it('ходьба слишком быстрая', () => {
    const p = ok({ ...base, mode: 'walk', derive: 'duration', distanceM: 5000, paceSecPerKm: 300, stepLengthM: 0.8 });
    expect(p.warnings.some((w) => /похоже на бег/.test(w))).toBe(true);
  });
  it('бег слишком медленный', () => {
    const p = ok({ ...base, mode: 'run', derive: 'duration', distanceM: 2000, paceSecPerKm: 720, stepLengthM: 0.8 });
    expect(p.warnings.some((w) => /похоже на ходьбу/.test(w))).toBe(true);
  });
  it('нормальные значения — без предупреждений', () => {
    const p = ok({ ...base, mode: 'run', derive: 'duration', distanceM: 5000, paceSecPerKm: 330, stepLengthM: 1.05 });
    expect(p.warnings).toEqual([]);
  });
});

describe('progressMetrics', () => {
  const plan = ok({ ...base, derive: 'duration', distanceM: 5000, paceSecPerKm: 360, stepLengthM: 1 });
  it('половина времени — половина дистанции', () => {
    const m = progressMetrics(plan, plan.durationS / 2);
    expect(m.progress).toBeCloseTo(0.5, 9);
    expect(m.distanceM).toBeCloseTo(2500, 6);
    expect(m.steps).toBe(2500);
  });
  it('границы: до старта и после финиша', () => {
    expect(progressMetrics(plan, -10).distanceM).toBe(0);
    expect(progressMetrics(plan, plan.durationS * 3).distanceM).toBeCloseTo(5000, 6);
  });
});
