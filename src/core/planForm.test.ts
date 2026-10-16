import { describe, expect, it } from 'vitest';
import { defaultPaceText, derivedText, initialForm, isClosedRoute, parsePlanForm, repeatNeeded, suggestRepeat, type PlanForm } from './planForm';

const base = (patch: Partial<PlanForm> = {}): PlanForm => ({ ...initialForm('run', 172), distance: '5', pace: '6:00', ...patch });

describe('parsePlanForm', () => {
  it('вычисляет время по дистанции и темпу', () => {
    const p = parsePlanForm(base({ derive: 'duration' }));
    expect(p.result.ok).toBe(true);
    if (p.result.ok) expect(p.result.plan.durationS).toBeCloseTo(1800, 6);
  });
  it('вычисляет темп по дистанции и времени', () => {
    const p = parsePlanForm(base({ derive: 'pace', duration: '25:00', pace: '' }));
    expect(p.result.ok && p.result.plan.paceSecPerKm).toBeCloseTo(300, 6);
  });
  it('вычисляет дистанцию по времени и темпу', () => {
    const p = parsePlanForm(base({ derive: 'distance', distance: '', duration: '1:00:00' }));
    expect(p.result.ok && p.result.plan.distanceM).toBeCloseTo(10_000, 6);
  });
  it('скорость вместо темпа: 12 км/ч = 5:00/км', () => {
    const p = parsePlanForm(base({ paceUnit: 'speed', pace: '12', derive: 'duration' }));
    expect(p.result.ok && p.result.plan.paceSecPerKm).toBeCloseTo(300, 6);
  });
  it('десятичная запятая в дистанции и шаге', () => {
    const p = parsePlanForm(base({ distance: '5,25', stepLength: '1,1' }));
    expect(p.result.ok && p.result.plan.distanceM).toBeCloseTo(5250, 6);
    expect(p.result.ok && p.result.plan.stepLengthM).toBeCloseTo(1.1, 9);
  });
  it('количество шагов вместо длины шага', () => {
    const p = parsePlanForm(base({ stepMode: 'count', steps: '5000' }));
    expect(p.result.ok && p.result.plan.stepLengthM).toBeCloseTo(1, 9);
  });
  it('ошибки по полям при непонятном вводе', () => {
    const p = parsePlanForm(base({ distance: 'abc', pace: '6:99', stepLength: '' }));
    expect(p.result.ok).toBe(false);
    expect(p.fieldErrors.distance).toBeTruthy();
    expect(p.fieldErrors.pace).toBeTruthy();
    expect(p.fieldErrors.stepLength).toBeTruthy();
  });
  it('пустые обязательные поля — ошибка плана без «красных» полей', () => {
    const p = parsePlanForm(base({ distance: '' }));
    expect(p.result.ok).toBe(false);
    expect(p.fieldErrors.distance).toBeUndefined();
  });
  it('вычисляемое поле игнорирует то, что в нём было введено', () => {
    const p = parsePlanForm(base({ derive: 'duration', duration: 'мусор' }));
    expect(p.result.ok).toBe(true);
    expect(p.fieldErrors.duration).toBeUndefined();
  });
});

describe('derivedText', () => {
  it('показывает вычисленное значение в формате поля', () => {
    const f = base({ derive: 'duration' });
    expect(derivedText(f, parsePlanForm(f))).toBe('30:00');
    const g = base({ derive: 'pace', duration: '25:00', pace: '' });
    expect(derivedText(g, parsePlanForm(g))).toBe('5:00');
    const h = base({ derive: 'pace', duration: '25:00', pace: '', paceUnit: 'speed' });
    expect(derivedText(h, parsePlanForm(h))).toBe('12');
    const i = base({ derive: 'distance', distance: '', duration: '1:00:00' });
    expect(derivedText(i, parsePlanForm(i))).toBe('10');
  });
  it('при ошибке — прочерк', () => {
    const f = base({ distance: '' });
    expect(derivedText(f, parsePlanForm(f))).toBe('—');
  });
});

describe('форма по умолчанию', () => {
  it('темп по режиму и длина шага по росту', () => {
    expect(defaultPaceText('walk')).toBe('12:00');
    expect(defaultPaceText('run')).toBe('6:00');
    expect(initialForm('walk', 172).stepLength).toBe('0,71');
  });
});

describe('повтор маршрута', () => {
  it('нужен, только если дистанция заметно больше маршрута', () => {
    expect(repeatNeeded(5000, 5000)).toBe(false);
    expect(repeatNeeded(5020, 5000)).toBe(false);
    expect(repeatNeeded(6000, 5000)).toBe(true);
    expect(repeatNeeded(6000, 0)).toBe(false);
  });
  it('замкнутый маршрут → по кругу, иначе туда-обратно', () => {
    const loop = [55.75, 37.6, 55.76, 37.6, 55.76, 37.61, 55.75, 37.61, 55.75, 37.6];
    const line = [55.75, 37.6, 55.76, 37.61, 55.77, 37.62, 55.78, 37.63];
    expect(isClosedRoute(loop)).toBe(true);
    expect(suggestRepeat(loop)).toBe('loop');
    expect(suggestRepeat(line)).toBe('pingpong');
  });
});
