import { PacerDB } from './db/db';
import { Repo } from './db/repo';
import { solvePlan } from './core/metrics';
import { createSim } from './core/simulation';
import type { Activity, Route, SimParams } from './core/types';

let counter = 0;
/** Новая изолированная база для теста. */
export function freshRepo(name = `test-${Date.now()}-${counter++}`): Repo {
  return new Repo(new PacerDB(name));
}

export function makeRoute(id: string, patch: Partial<Route> = {}): Route {
  const coords = [55.75, 37.6, 55.76, 37.62, 55.77, 37.64];
  return {
    id, name: `Маршрут ${id}`, createdAt: 1000, updatedAt: 2000, source: 'drawn', coords,
    distanceM: 3000, pointCount: 3, ...patch,
  };
}

export function makeActivity(id: string, patch: Partial<Activity> = {}): Activity {
  return {
    id, mode: 'run', routeId: null, routeName: 'Тест', startedAt: 1_700_000_000_000, finishedAt: 1_700_000_900_000,
    durationS: 900, distanceM: 3000, avgSpeedKmh: 12, avgPaceSecPerKm: 300, steps: 3000, stepLengthM: 1,
    cadenceSpm: 200, caloriesKcal: 200, weightKg: 70, plannedDistanceM: 3000, plannedDurationS: 900,
    endedEarly: false, repeat: 'none', coords: [55.75, 37.6, 55.76, 37.62], ...patch,
  };
}

export function makeParams(patch: Partial<SimParams> = {}): SimParams {
  const r = solvePlan({ mode: 'run', derive: 'duration', distanceM: 1000, paceSecPerKm: 360, stepMode: 'length', stepLengthM: 1 });
  if (!r.ok) throw new Error('plan');
  return { mode: 'run', routeId: 'r1', routeName: 'Тест', routeLengthM: 1000, repeat: 'none', plan: r.plan, ...patch };
}

export const sim = (now: number) => createSim(makeParams(), now);
