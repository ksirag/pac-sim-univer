import { estimateCalories } from './calories';
import { Path, reduceToMaxPoints } from './geo';
import { elapsedMs } from './simulation';
import { newId } from './routeModel';
import { progressMetrics } from './metrics';
import type { Activity, SimState } from './types';

/** Собирает запись истории из завершённой симуляции. Калории — оценка по формуле. */
export function buildActivity(state: SimState, routeCoords: readonly number[], weightKg: number, id: string = newId()): Activity {
  const { plan, repeat } = state.params;
  const durationS = elapsedMs(state, state.finishedAt ?? Date.now()) / 1000;
  const { distanceM, steps } = progressMetrics(plan, durationS);
  const path = new Path(routeCoords);
  let coords: number[] = [];
  if (path.length > 0) {
    coords = repeat === 'none' && distanceM < path.length ? path.sliceTo(distanceM) : [...routeCoords];
  }
  const avgSpeedKmh = durationS > 0 ? (distanceM / 1000) / (durationS / 3600) : 0;
  return {
    id,
    mode: state.params.mode,
    routeId: state.params.routeId,
    routeName: state.params.routeName,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt ?? Date.now(),
    durationS,
    distanceM,
    avgSpeedKmh,
    avgPaceSecPerKm: distanceM > 0 ? durationS / (distanceM / 1000) : 0,
    steps,
    stepLengthM: plan.stepLengthM,
    cadenceSpm: durationS > 0 ? steps / (durationS / 60) : 0,
    caloriesKcal: estimateCalories(state.params.mode, avgSpeedKmh, weightKg, durationS),
    weightKg,
    plannedDistanceM: plan.distanceM,
    plannedDurationS: plan.durationS,
    endedEarly: state.endedEarly,
    repeat,
    coords: reduceToMaxPoints(coords, 1500),
  };
}
