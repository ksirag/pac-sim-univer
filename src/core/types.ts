/** Географическая точка. Везде в приложении порядок «широта, долгота» (lat, lng). */
export interface LatLng {
  lat: number;
  lng: number;
}

export type ActivityMode = 'walk' | 'run';
export type RepeatMode = 'none' | 'loop' | 'pingpong';
export type RouteSource = 'drawn' | 'gpx' | 'copy';

/**
 * Маршрут. Геометрия хранится плоским массивом [lat0, lng0, lat1, lng1, …]:
 * так компактнее в IndexedDB и быстрее для больших треков.
 */
export interface Route {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  source: RouteSource;
  /** Полная геометрия маршрута (плоский массив lat,lng). */
  coords: number[];
  /** Опорные точки для редактирования (плоский массив). Нет у импортированных треков. */
  control?: number[];
  /**
   * Геометрия участков между соседними опорными точками (длина = опорных точек − 1).
   * null — прямая линия; массив — маршрут по улицам.
   */
  legs?: (number[] | null)[];
  distanceM: number;
  pointCount: number;
}

export interface Plan {
  distanceM: number;
  durationS: number;
  speedKmh: number;
  paceSecPerKm: number;
  stepLengthM: number;
  steps: number;
  cadenceSpm: number;
  warnings: string[];
}

export interface SimParams {
  mode: ActivityMode;
  routeId: string | null;
  routeName: string;
  routeLengthM: number;
  repeat: RepeatMode;
  plan: Plan;
}

export type SimStatus = 'running' | 'paused' | 'finished';

export interface SimState {
  status: SimStatus;
  params: SimParams;
  /** Момент первого запуска (мс, Date.now()). */
  startedAt: number;
  /** Накопленное активное время (мс) без текущего отрезка. */
  accumulatedMs: number;
  /** Начало текущего отрезка «бежит» (мс) или null на паузе/после завершения. */
  resumedAt: number | null;
  /** Последний момент, когда приложение точно было открыто (для политики «пауза»). */
  lastSeenAt: number;
  finishedAt: number | null;
  /** Остановлена досрочно (до достижения цели). */
  endedEarly: boolean;
}

export interface Activity {
  id: string;
  mode: ActivityMode;
  routeId: string | null;
  routeName: string;
  startedAt: number;
  finishedAt: number;
  /** Активное время без пауз, секунды. */
  durationS: number;
  distanceM: number;
  avgSpeedKmh: number;
  avgPaceSecPerKm: number;
  steps: number;
  stepLengthM: number;
  cadenceSpm: number;
  /** Оценка по формулам, а не измерение датчиков. */
  caloriesKcal: number;
  weightKg: number;
  plannedDistanceM: number;
  plannedDurationS: number;
  endedEarly: boolean;
  repeat: RepeatMode;
  /** Упрощённая геометрия пройденного маршрута (плоский массив) для карточки итога. */
  coords: number[];
}

export interface ActiveRecord {
  id: 'current';
  state: SimState;
  /** Снимок геометрии: маршрут могли удалить или изменить во время активности. */
  coords: number[];
  savedAt: number;
}

export type ThemeSetting = 'auto' | 'light' | 'dark';
export type ResumePolicy = 'continue' | 'pause';
export type RoutingPreset = 'fossgis-foot' | 'custom';
export type TilesPreset = 'osm' | 'custom';

export interface Settings {
  theme: ThemeSetting;
  weightKg: number;
  heightCm: number;
  resumePolicy: ResumePolicy;
  routingEnabled: boolean;
  routingPreset: RoutingPreset;
  routingCustomUrl: string;
  routingCustomProfile: string;
  tilesPreset: TilesPreset;
  tilesCustomUrl: string;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'auto',
  weightKg: 70,
  heightCm: 172,
  resumePolicy: 'continue',
  routingEnabled: true,
  routingPreset: 'fossgis-foot',
  routingCustomUrl: '',
  routingCustomProfile: 'foot',
  tilesPreset: 'osm',
  tilesCustomUrl: '',
};
