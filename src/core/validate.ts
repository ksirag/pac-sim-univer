import { flatCount, flatLength, isValidLatLng } from './geo';
import { DEFAULT_SETTINGS, type ActivityMode, type Activity, type RepeatMode, type Route, type Settings } from './types';

export const MAX_ROUTE_POINTS = 500_000;
export const MAX_ACTIVITY_POINTS = 20_000;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null);

export function isFlatCoords(v: unknown, maxPoints: number): v is number[] {
  if (!Array.isArray(v) || v.length % 2 !== 0 || v.length / 2 > maxPoints) return false;
  for (let i = 0; i < v.length; i += 2) {
    if (!isNum(v[i]) || !isNum(v[i + 1]) || !isValidLatLng(v[i] as number, v[i + 1] as number)) return false;
  }
  return true;
}

/** Проверяет и нормализует маршрут из внешнего источника. Длина и число точек пересчитываются. */
export function validateRoute(raw: unknown): Route | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id, 100);
  const name = str(raw.name, 200);
  if (!id || name === null || !isNum(raw.createdAt) || !isNum(raw.updatedAt)) return null;
  if (!isFlatCoords(raw.coords, MAX_ROUTE_POINTS) || flatCount(raw.coords) < 2) return null;
  const source = raw.source === 'drawn' || raw.source === 'gpx' || raw.source === 'copy' ? raw.source : 'drawn';
  const route: Route = {
    id,
    name: name.trim() || 'Без названия',
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    source,
    coords: raw.coords,
    distanceM: flatLength(raw.coords),
    pointCount: flatCount(raw.coords),
  };
  if (isFlatCoords(raw.control, 5000) && flatCount(raw.control) >= 2) {
    route.control = raw.control;
    const legsRaw = Array.isArray(raw.legs) ? raw.legs : [];
    const legs: (number[] | null)[] = [];
    for (let i = 0; i < flatCount(raw.control) - 1; i++) {
      const leg = legsRaw[i];
      legs.push(isFlatCoords(leg, MAX_ROUTE_POINTS) && leg.length >= 4 ? leg : null);
    }
    route.legs = legs;
  }
  return route;
}

const MODES: readonly ActivityMode[] = ['walk', 'run'];
const REPEATS: readonly RepeatMode[] = ['none', 'loop', 'pingpong'];

export function validateActivity(raw: unknown): Activity | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id, 100);
  const routeName = str(raw.routeName, 200);
  if (!id || routeName === null) return null;
  if (!MODES.includes(raw.mode as ActivityMode)) return null;
  const nums = [
    raw.startedAt, raw.finishedAt, raw.durationS, raw.distanceM, raw.avgSpeedKmh, raw.avgPaceSecPerKm,
    raw.steps, raw.stepLengthM, raw.cadenceSpm, raw.caloriesKcal, raw.weightKg, raw.plannedDistanceM, raw.plannedDurationS,
  ];
  if (!nums.every(isNum) || (raw.durationS as number) < 0 || (raw.distanceM as number) < 0) return null;
  if (!isFlatCoords(raw.coords, MAX_ACTIVITY_POINTS)) return null;
  if (raw.routeId !== null && str(raw.routeId, 100) === null) return null;
  return {
    id,
    mode: raw.mode as ActivityMode,
    routeId: (raw.routeId as string | null) ?? null,
    routeName,
    startedAt: raw.startedAt as number,
    finishedAt: raw.finishedAt as number,
    durationS: raw.durationS as number,
    distanceM: raw.distanceM as number,
    avgSpeedKmh: raw.avgSpeedKmh as number,
    avgPaceSecPerKm: raw.avgPaceSecPerKm as number,
    steps: raw.steps as number,
    stepLengthM: raw.stepLengthM as number,
    cadenceSpm: raw.cadenceSpm as number,
    caloriesKcal: raw.caloriesKcal as number,
    weightKg: raw.weightKg as number,
    plannedDistanceM: raw.plannedDistanceM as number,
    plannedDurationS: raw.plannedDurationS as number,
    endedEarly: raw.endedEarly === true,
    repeat: REPEATS.includes(raw.repeat as RepeatMode) ? (raw.repeat as RepeatMode) : 'none',
    coords: raw.coords,
  };
}

/** Настройки: берём только известные поля допустимого типа, остальное — значения по умолчанию. */
export function validateSettings(raw: unknown): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS };
  if (!isObj(raw)) return s;
  if (raw.theme === 'auto' || raw.theme === 'light' || raw.theme === 'dark') s.theme = raw.theme;
  if (isNum(raw.weightKg) && raw.weightKg >= 20 && raw.weightKg <= 300) s.weightKg = raw.weightKg;
  if (isNum(raw.heightCm) && raw.heightCm >= 100 && raw.heightCm <= 230) s.heightCm = raw.heightCm;
  if (raw.resumePolicy === 'continue' || raw.resumePolicy === 'pause') s.resumePolicy = raw.resumePolicy;
  if (typeof raw.routingEnabled === 'boolean') s.routingEnabled = raw.routingEnabled;
  if (raw.routingPreset === 'fossgis-foot' || raw.routingPreset === 'custom') s.routingPreset = raw.routingPreset;
  const ru = str(raw.routingCustomUrl, 300);
  if (ru !== null) s.routingCustomUrl = ru;
  const rp = str(raw.routingCustomProfile, 40);
  if (rp !== null) s.routingCustomProfile = rp;
  if (raw.tilesPreset === 'osm' || raw.tilesPreset === 'custom') s.tilesPreset = raw.tilesPreset;
  const tu = str(raw.tilesCustomUrl, 300);
  if (tu !== null) s.tilesCustomUrl = tu;
  return s;
}
