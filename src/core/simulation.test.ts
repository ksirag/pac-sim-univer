import { describe, expect, it } from 'vitest';
import { Path } from './geo';
import { solvePlan } from './metrics';
import {
  autoFinishIfDue, createSim, elapsedMs, finish, isTargetReached, pause, reconcile, resume, snapshot, touch,
} from './simulation';
import type { SimParams } from './types';

const planRes = solvePlan({ mode: 'run', derive: 'duration', distanceM: 1000, paceSecPerKm: 360, stepMode: 'length', stepLengthM: 1 });
if (!planRes.ok) throw new Error('plan');
// 1000 м при 6:00/км = 360 секунд
const params: SimParams = {
  mode: 'run', routeId: 'r1', routeName: 'Тест', routeLengthM: 1000, repeat: 'none', plan: planRes.plan,
};
const T0 = 1_700_000_000_000;
const s = (ms: number) => T0 + ms * 1000;

describe('время по меткам', () => {
  it('идёт вперёд только пока активность запущена', () => {
    let st = createSim(params, s(0));
    expect(elapsedMs(st, s(10))).toBe(10_000);
    st = pause(st, s(10));
    expect(st.status).toBe('paused');
    expect(elapsedMs(st, s(500))).toBe(10_000); // на паузе время стоит
    st = resume(st, s(500));
    expect(elapsedMs(st, s(520))).toBe(30_000);
  });
  it('не зависит от числа вызовов (никаких тиков)', () => {
    const st = createSim(params, s(0));
    expect(elapsedMs(st, s(100))).toBe(100_000); // единственный вызов через 100 с
  });
  it('повторная пауза/возобновление идемпотентны', () => {
    const st = createSim(params, s(0));
    const p1 = pause(st, s(5));
    expect(pause(p1, s(50))).toBe(p1);
    expect(resume(st, s(7))).toBe(st);
  });
  it('время не уходит в минус при сбое часов', () => {
    const st = createSim(params, s(100));
    expect(elapsedMs(st, s(50))).toBe(0);
    const p = pause(st, s(50));
    expect(p.accumulatedMs).toBe(0);
  });
  it('время ограничено целевой длительностью', () => {
    const st = createSim(params, s(0));
    expect(elapsedMs(st, s(10_000))).toBe(360_000);
    expect(isTargetReached(st, s(360))).toBe(true);
    expect(isTargetReached(st, s(359))).toBe(false);
  });
  it('нельзя возобновить после достижения цели', () => {
    const st = createSim(params, s(0));
    const p = pause({ ...st, accumulatedMs: 360_000, resumedAt: null, status: 'paused' }, s(500));
    expect(resume(p, s(600))).toBe(p);
  });
});

describe('завершение', () => {
  it('досрочное завершение помечается endedEarly', () => {
    const st = finish(createSim(params, s(0)), s(100));
    expect(st.status).toBe('finished');
    expect(st.endedEarly).toBe(true);
    expect(st.accumulatedMs).toBe(100_000);
    expect(st.finishedAt).toBe(s(100));
  });
  it('завершение с паузы не добавляет времени', () => {
    let st = pause(createSim(params, s(0)), s(40));
    st = finish(st, s(900));
    expect(st.accumulatedMs).toBe(40_000);
  });
  it('цель достигнута раньше — момент окончания = момент достижения цели', () => {
    const st = finish(createSim(params, s(0)), s(1000));
    expect(st.endedEarly).toBe(false);
    expect(st.finishedAt).toBe(s(360));
    expect(st.accumulatedMs).toBe(360_000);
  });
  it('autoFinishIfDue завершает только при достижении цели', () => {
    const st = createSim(params, s(0));
    expect(autoFinishIfDue(st, s(100))).toBe(st);
    expect(autoFinishIfDue(st, s(400)).status).toBe('finished');
  });
  it('повторное завершение ничего не меняет', () => {
    const f = finish(createSim(params, s(0)), s(10));
    expect(finish(f, s(99))).toBe(f);
  });
});

describe('восстановление (reconcile)', () => {
  it('«продолжить»: время за отсутствие засчитывается по меткам', () => {
    let st = createSim(params, s(0));
    st = touch(st, s(30));
    const r = reconcile(st, s(200), 'continue');
    expect(r.status).toBe('running');
    expect(elapsedMs(r, s(200))).toBe(200_000);
  });
  it('«продолжить» после того, как цель достигнута: автозавершение в момент цели', () => {
    const st = touch(createSim(params, s(0)), s(30));
    const r = reconcile(st, s(5000), 'continue');
    expect(r.status).toBe('finished');
    expect(r.finishedAt).toBe(s(360));
    expect(r.endedEarly).toBe(false);
  });
  it('«пауза»: считается только время до последнего момента, когда приложение было открыто', () => {
    const st = touch(createSim(params, s(0)), s(30));
    const r = reconcile(st, s(500), 'pause');
    expect(r.status).toBe('paused');
    expect(r.accumulatedMs).toBe(30_000);
  });
  it('на паузе и после финиша состояние не меняется', () => {
    const p = pause(createSim(params, s(0)), s(10));
    expect(reconcile(p, s(999), 'continue')).toBe(p);
    const f = finish(createSim(params, s(0)), s(10));
    expect(reconcile(f, s(999), 'pause')).toBe(f);
  });
  it('состояние сериализуется в JSON и восстанавливается без потерь', () => {
    const st = pause(createSim(params, s(0)), s(77));
    const back = JSON.parse(JSON.stringify(st));
    expect(back).toEqual(st);
    expect(elapsedMs(back, s(1000))).toBe(77_000);
  });
});

describe('snapshot', () => {
  const path = new Path([0, 0, 0.0045, 0]); // ≈ 500 м
  it('показатели согласованы с планом', () => {
    const st = createSim({ ...params, routeLengthM: path.length }, s(0));
    const sn = snapshot(st, path, s(180)); // половина времени
    expect(sn.progress).toBeCloseTo(0.5, 6);
    expect(sn.distanceM).toBeCloseTo(500, 6);
    expect(sn.steps).toBe(500);
    expect(sn.speedKmh).toBeCloseTo(10, 6);
    expect(sn.paceSecPerKm).toBeCloseTo(360, 6);
    expect(sn.targetReached).toBe(false);
  });
  it('маркер в конце маршрута, когда цель достигнута', () => {
    const st = createSim(params, s(0));
    const sn = snapshot(st, path, s(400));
    expect(sn.targetReached).toBe(true);
    expect(sn.position!.lat).toBeCloseTo(0.0045, 6);
  });
  it('на кругах маркер возвращается к началу', () => {
    const st = createSim({ ...params, repeat: 'loop' }, s(0));
    const sn = snapshot(st, path, s(270)); // 750 м, маршрут ≈ 500 м → 250 м от начала
    expect(sn.routeDistanceM).toBeCloseTo(750 - path.length, 3);
  });
  it('без геометрии позиция null', () => {
    expect(snapshot(createSim(params, s(0)), null, s(10)).position).toBeNull();
  });
});
