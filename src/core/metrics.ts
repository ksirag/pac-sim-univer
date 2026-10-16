import type { ActivityMode, Plan } from './types';

/** Разумные границы для режимов. «soft» — предупреждение, «hard» — ошибка ввода. */
export const MODE_LIMITS = {
  walk: {
    softMaxKmh: 7.5,
    softMinKmh: 1.5,
    defaultKmh: 5,
    cadence: [60, 150] as const,
    step: [0.3, 1.2] as const,
  },
  run: {
    softMaxKmh: 25,
    softMinKmh: 6,
    defaultKmh: 10,
    cadence: [120, 210] as const,
    step: [0.5, 2.3] as const,
  },
} as const;

export const HARD = {
  minDistanceM: 10,
  maxDistanceM: 200_000,
  minDurationS: 10,
  maxDurationS: 24 * 3600,
  minPaceSPerKm: 90, // 40 км/ч
  maxPaceSPerKm: 3600, // 1 км/ч
  minStepM: 0.1,
  maxStepM: 3,
} as const;

/** Выбор величины, которая вычисляется из двух остальных. */
export type Derive = 'duration' | 'pace' | 'distance';

export interface PlanInput {
  mode: ActivityMode;
  /** Какая из трёх величин вычисляется; две другие считаются заданными. */
  derive: Derive;
  distanceM?: number;
  durationS?: number;
  paceSecPerKm?: number;
  /** Как задана длина шага: напрямую или через общее число шагов. */
  stepMode: 'length' | 'count';
  stepLengthM?: number;
  steps?: number;
}

export type PlanResult = { ok: true; plan: Plan } | { ok: false; errors: string[] };

export function paceToSpeedKmh(paceSecPerKm: number): number {
  return 3600 / paceSecPerKm;
}

export function speedKmhToPace(speedKmh: number): number {
  return 3600 / speedKmh;
}

/** Типичная длина шага по росту: ходьба ≈ 0,415·рост, бег ≈ 0,65·рост (грубая оценка). */
export function defaultStepLength(mode: ActivityMode, heightCm: number): number {
  const h = Number.isFinite(heightCm) && heightCm >= 100 && heightCm <= 230 ? heightCm / 100 : 1.72;
  const k = mode === 'walk' ? 0.415 : 0.65;
  return Math.round(h * k * 100) / 100;
}

function isPositive(v: number | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/**
 * Согласует дистанцию, время, темп и шаги. Любые две из трёх величин определяют третью,
 * поэтому противоречий между ними не возникает: пользователь выбирает, что вычислять.
 * Нереалистичные, но возможные значения дают предупреждения; невозможные — ошибки.
 */
export function solvePlan(input: PlanInput): PlanResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { mode, derive } = input;

  let distanceM = input.distanceM;
  let durationS = input.durationS;
  let pace = input.paceSecPerKm;

  if (derive !== 'distance' && !isPositive(distanceM)) errors.push('Укажите дистанцию больше нуля.');
  if (derive !== 'duration' && !isPositive(durationS)) errors.push('Укажите длительность больше нуля.');
  if (derive !== 'pace' && !isPositive(pace)) errors.push('Укажите темп или скорость больше нуля.');
  if (errors.length) return { ok: false, errors };

  if (derive === 'duration') durationS = (distanceM! / 1000) * pace!;
  else if (derive === 'pace') pace = durationS! / (distanceM! / 1000);
  else distanceM = (durationS! / pace!) * 1000;

  const d = distanceM!;
  const t = durationS!;
  const p = pace!;

  if (d < HARD.minDistanceM) errors.push(`Дистанция слишком мала: минимум ${HARD.minDistanceM} м.`);
  if (d > HARD.maxDistanceM) errors.push(`Дистанция слишком велика: максимум ${HARD.maxDistanceM / 1000} км.`);
  if (t < HARD.minDurationS) errors.push(`Длительность слишком мала: минимум ${HARD.minDurationS} с.`);
  if (t > HARD.maxDurationS) errors.push('Длительность не может превышать 24 часа.');
  if (p < HARD.minPaceSPerKm) errors.push('Скорость нереалистична: быстрее 40 км/ч.');
  if (p > HARD.maxPaceSPerKm) errors.push('Скорость слишком мала: медленнее 1 км/ч.');

  const speedKmh = paceToSpeedKmh(p);
  const lim = MODE_LIMITS[mode];
  if (mode === 'walk' && speedKmh > lim.softMaxKmh) {
    warnings.push('Для ходьбы это очень высокая скорость — похоже на бег. Проверьте режим.');
  }
  if (mode === 'walk' && speedKmh < lim.softMinKmh) warnings.push('Очень медленная ходьба — проверьте значения.');
  if (mode === 'run' && speedKmh < lim.softMinKmh) warnings.push('Для бега это очень медленный темп — похоже на ходьбу.');
  if (mode === 'run' && speedKmh > lim.softMaxKmh) warnings.push('Очень высокая скорость для бега — проверьте значения.');

  let stepLengthM = input.stepLengthM ?? NaN;
  let steps: number;
  if (input.stepMode === 'count') {
    if (!isPositive(input.steps)) {
      errors.push('Укажите количество шагов больше нуля.');
      steps = NaN;
    } else {
      steps = Math.round(input.steps);
      stepLengthM = d / steps;
    }
  } else {
    if (!isPositive(stepLengthM)) {
      errors.push('Укажите длину шага больше нуля.');
      steps = NaN;
    } else {
      steps = Math.round(d / stepLengthM);
    }
  }
  if (errors.length) return { ok: false, errors };

  if (stepLengthM < HARD.minStepM || stepLengthM > HARD.maxStepM) {
    errors.push(`Длина шага должна быть от ${HARD.minStepM} до ${HARD.maxStepM} м.`);
    return { ok: false, errors };
  }
  if (stepLengthM < lim.step[0] || stepLengthM > lim.step[1]) {
    warnings.push(`Необычная длина шага для этого режима (${lim.step[0]}–${lim.step[1]} м).`);
  }
  const cadenceSpm = steps / (t / 60);
  if (cadenceSpm < lim.cadence[0] || cadenceSpm > lim.cadence[1]) {
    warnings.push(`Необычная частота шагов: ${Math.round(cadenceSpm)} в минуту.`);
  }

  return {
    ok: true,
    plan: { distanceM: d, durationS: t, speedKmh, paceSecPerKm: p, stepLengthM, steps, cadenceSpm, warnings },
  };
}

/** Показатели при частичном выполнении плана (по прошедшему времени). */
export function progressMetrics(plan: Plan, elapsedS: number) {
  const progress = plan.durationS > 0 ? Math.min(1, Math.max(0, elapsedS / plan.durationS)) : 0;
  const distanceM = plan.distanceM * progress;
  const steps = plan.stepLengthM > 0 ? Math.round(distanceM / plan.stepLengthM) : 0;
  return { progress, distanceM, steps };
}
