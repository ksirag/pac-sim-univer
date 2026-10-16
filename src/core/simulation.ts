import { Path, mapDistanceToRoute, type PointOnPath } from './geo';
import { progressMetrics } from './metrics';
import type { ResumePolicy, SimParams, SimState } from './types';

/**
 * Модель симуляции — чистые функции над сериализуемым состоянием.
 * Время считается ТОЛЬКО по меткам (Date.now()), а не по числу тиков таймера:
 * если вкладка была свёрнута или приложение закрыто, состояние восстанавливается по меткам.
 * iOS может приостанавливать веб-приложения в фоне, поэтому непрерывная работа в фоне не гарантируется.
 */

const targetMs = (p: SimParams) => Math.round(p.plan.durationS * 1000);

export function createSim(params: SimParams, now: number): SimState {
  return {
    status: 'running',
    params,
    startedAt: now,
    accumulatedMs: 0,
    resumedAt: now,
    lastSeenAt: now,
    finishedAt: null,
    endedEarly: false,
  };
}

/** Активное время (без пауз) в миллисекундах, не больше целевой длительности. */
export function elapsedMs(s: SimState, now: number): number {
  let ms = s.accumulatedMs;
  if (s.status === 'running' && s.resumedAt !== null) ms += Math.max(0, now - s.resumedAt);
  return Math.min(ms, targetMs(s.params));
}

export function isTargetReached(s: SimState, now: number): boolean {
  return elapsedMs(s, now) >= targetMs(s.params);
}

export function pause(s: SimState, now: number): SimState {
  if (s.status !== 'running') return s;
  return { ...s, status: 'paused', accumulatedMs: elapsedMs(s, now), resumedAt: null, lastSeenAt: now };
}

export function resume(s: SimState, now: number): SimState {
  if (s.status !== 'paused') return s;
  if (s.accumulatedMs >= targetMs(s.params)) return s;
  return { ...s, status: 'running', resumedAt: now, lastSeenAt: now };
}

/** Завершает активность. Если цель достигнута раньше, момент окончания = момент достижения цели. */
export function finish(s: SimState, now: number): SimState {
  if (s.status === 'finished') return s;
  const total = targetMs(s.params);
  const elapsed = elapsedMs(s, now);
  const reached = elapsed >= total;
  let finishedAt = now;
  if (reached && s.status === 'running' && s.resumedAt !== null) {
    finishedAt = s.resumedAt + (total - s.accumulatedMs);
  }
  return {
    ...s,
    status: 'finished',
    accumulatedMs: elapsed,
    resumedAt: null,
    finishedAt: Math.min(finishedAt, now),
    lastSeenAt: now,
    endedEarly: !reached,
  };
}

/** Если цель достигнута, автоматически завершает; иначе возвращает состояние как есть. */
export function autoFinishIfDue(s: SimState, now: number): SimState {
  return s.status === 'running' && isTargetReached(s, now) ? finish(s, now) : s;
}

export function touch(s: SimState, now: number): SimState {
  return s.status === 'finished' ? s : { ...s, lastSeenAt: Math.max(s.lastSeenAt, now) };
}

/**
 * Восстановление после возврата в приложение или перезагрузки.
 * 'continue' — время за период отсутствия засчитывается по меткам.
 * 'pause'   — считаем, что активность остановилась в последний момент, когда приложение было открыто.
 */
export function reconcile(s: SimState, now: number, policy: ResumePolicy): SimState {
  if (s.status !== 'running' || s.resumedAt === null) return s;
  if (policy === 'pause') {
    const seen = Math.min(Math.max(s.lastSeenAt, s.resumedAt), now);
    const paused = pause(s, seen);
    return { ...paused, lastSeenAt: now };
  }
  return autoFinishIfDue(s, now);
}

export interface SimSnapshot {
  elapsedS: number;
  progress: number;
  distanceM: number;
  steps: number;
  speedKmh: number;
  paceSecPerKm: number;
  /** Положение на маршруте (если геометрия есть). */
  position: PointOnPath | null;
  /** Дистанция вдоль маршрута (после учёта кругов/возврата). */
  routeDistanceM: number;
  targetReached: boolean;
}

/** Текущие показатели. Движение — по модели постоянной скорости, заданной планом. */
export function snapshot(s: SimState, path: Path | null, now: number): SimSnapshot {
  const elapsedS = elapsedMs(s, now) / 1000;
  const { progress, distanceM, steps } = progressMetrics(s.params.plan, elapsedS);
  const routeDistanceM = mapDistanceToRoute(distanceM, path?.length ?? 0, s.params.repeat);
  return {
    elapsedS,
    progress,
    distanceM,
    steps,
    speedKmh: s.params.plan.speedKmh,
    paceSecPerKm: s.params.plan.paceSecPerKm,
    position: path ? path.pointAt(routeDistanceM) : null,
    routeDistanceM,
    targetReached: progress >= 1,
  };
}
