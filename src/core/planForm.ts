import { distanceBetween } from './geo';
import { formatDuration, formatPace, parseDecimal, parseDuration, parsePace } from './format';
import { MODE_LIMITS, defaultStepLength, paceToSpeedKmh, solvePlan, speedKmhToPace, type Derive, type PlanResult } from './metrics';
import type { ActivityMode, RepeatMode } from './types';

/** Состояние формы настройки симуляции (тексты полей — как их ввёл пользователь). */
export interface PlanForm {
  mode: ActivityMode;
  derive: Derive;
  distance: string; // км
  duration: string; // ч:мм:сс или мин
  pace: string; // мин/км или км/ч — зависит от paceUnit
  paceUnit: 'pace' | 'speed';
  stepMode: 'length' | 'count';
  stepLength: string; // м
  steps: string;
  /** Пользователь менял длину шага вручную — не подставлять значение по росту. */
  stepTouched: boolean;
  repeat: RepeatMode;
}

export function defaultPaceText(mode: ActivityMode): string {
  return formatPace(speedKmhToPace(MODE_LIMITS[mode].defaultKmh));
}

export function initialForm(mode: ActivityMode, heightCm: number): PlanForm {
  return {
    mode,
    derive: 'duration',
    distance: '',
    duration: '',
    pace: defaultPaceText(mode),
    paceUnit: 'pace',
    stepMode: 'length',
    stepLength: String(defaultStepLength(mode, heightCm)).replace('.', ','),
    steps: '',
    stepTouched: false,
    repeat: 'none',
  };
}

export interface ParsedForm {
  result: PlanResult;
  /** Ошибки разбора по полям (текст введён, но не понят). */
  fieldErrors: Partial<Record<'distance' | 'duration' | 'pace' | 'stepLength' | 'steps', string>>;
}

/** Разбирает форму и считает план. Вычисляемое поле из ввода игнорируется. */
export function parsePlanForm(form: PlanForm): ParsedForm {
  const fieldErrors: ParsedForm['fieldErrors'] = {};
  const need = (derive: Derive) => form.derive !== derive;

  let distanceM: number | undefined;
  if (need('distance')) {
    const v = parseDecimal(form.distance);
    if (Number.isFinite(v)) distanceM = v * 1000;
    else if (form.distance.trim()) fieldErrors.distance = 'Введите число, например 5 или 5,2';
  }
  let durationS: number | undefined;
  if (need('duration')) {
    const v = parseDuration(form.duration);
    if (Number.isFinite(v)) durationS = v;
    else if (form.duration.trim()) fieldErrors.duration = 'Формат: 45:00 или 1:30:00 (или минуты числом)';
  }
  let paceSecPerKm: number | undefined;
  if (need('pace')) {
    if (form.paceUnit === 'pace') {
      const v = parsePace(form.pace);
      if (Number.isFinite(v)) paceSecPerKm = v;
      else if (form.pace.trim()) fieldErrors.pace = 'Формат: 6:05 (минуты:секунды на километр)';
    } else {
      const v = parseDecimal(form.pace);
      if (Number.isFinite(v) && v > 0) paceSecPerKm = speedKmhToPace(v);
      else if (form.pace.trim()) fieldErrors.pace = 'Введите скорость, например 9,5';
    }
  }
  let stepLengthM: number | undefined;
  let steps: number | undefined;
  if (form.stepMode === 'length') {
    const v = parseDecimal(form.stepLength);
    if (Number.isFinite(v)) stepLengthM = v;
    else fieldErrors.stepLength = 'Введите длину шага в метрах, например 0,75';
  } else {
    const v = parseDecimal(form.steps);
    if (Number.isFinite(v) && Number.isInteger(v)) steps = v;
    else fieldErrors.steps = 'Введите целое число шагов';
  }

  const result = solvePlan({
    mode: form.mode, derive: form.derive, distanceM, durationS, paceSecPerKm,
    stepMode: form.stepMode, stepLengthM, steps,
  });
  return { result, fieldErrors };
}

/** Текст вычисленного значения для отображения в «вычисляемом» поле. */
export function derivedText(form: PlanForm, parsed: ParsedForm): string {
  if (!parsed.result.ok) return '—';
  const p = parsed.result.plan;
  if (form.derive === 'distance') return String(Math.round(p.distanceM) / 1000).replace('.', ',');
  if (form.derive === 'duration') return formatDuration(p.durationS);
  return form.paceUnit === 'pace' ? formatPace(p.paceSecPerKm) : String(Math.round(paceToSpeedKmh(p.paceSecPerKm) * 10) / 10).replace('.', ',');
}

/** Дистанция заметно больше маршрута — нужно решить, что делать на «лишнем» участке. */
export function repeatNeeded(distanceM: number, routeLengthM: number): boolean {
  return routeLengthM > 0 && distanceM > routeLengthM * 1.005;
}

/** Маршрут замкнут (начало и конец рядом): тогда естественнее ходить по кругу. */
export function isClosedRoute(coords: readonly number[]): boolean {
  if (coords.length < 8) return false;
  const n = coords.length;
  return distanceBetween({ lat: coords[0]!, lng: coords[1]! }, { lat: coords[n - 2]!, lng: coords[n - 1]! }) < 30;
}

export function suggestRepeat(coords: readonly number[]): RepeatMode {
  return isClosedRoute(coords) ? 'loop' : 'pingpong';
}
