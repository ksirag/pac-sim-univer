import { flatCount, flatLength, fromFlat, joinFlat, reduceToMaxPoints, simplify, toFlat } from './geo';
import type { LatLng, Route, RouteSource } from './types';

/** Состояние редактора точек: опорные точки и геометрия участков между ними. */
export interface EditablePath {
  control: LatLng[];
  /** legs[i] — участок между control[i] и control[i+1]; null — прямая линия. */
  legs: (number[] | null)[];
}

export const MAX_EDITABLE_POINTS = 200;
export const EMPTY_PATH: EditablePath = { control: [], legs: [] };

function legGeometry(a: LatLng, b: LatLng, leg: number[] | null): number[] {
  return leg && leg.length >= 4 ? leg : [a.lat, a.lng, b.lat, b.lng];
}

/** Полная геометрия: склейка участков (прямых или построенных по улицам). */
export function buildGeometry(path: EditablePath): number[] {
  const { control, legs } = path;
  if (control.length === 0) return [];
  if (control.length === 1) return [control[0]!.lat, control[0]!.lng];
  const parts: number[][] = [];
  for (let i = 0; i < control.length - 1; i++) parts.push(legGeometry(control[i]!, control[i + 1]!, legs[i] ?? null));
  return joinFlat(parts);
}

export function addPoint(path: EditablePath, point: LatLng, leg: number[] | null = null): EditablePath {
  const control = [...path.control, point];
  const legs = control.length > 1 ? [...path.legs, leg] : [];
  return { control, legs };
}

/** Перемещение точки: примыкающие участки сбрасываются в прямые (их можно перестроить заново). */
export function movePoint(path: EditablePath, index: number, point: LatLng): EditablePath {
  if (index < 0 || index >= path.control.length) return path;
  const control = path.control.map((p, i) => (i === index ? point : p));
  const legs = path.legs.map((leg, i) => (i === index - 1 || i === index ? null : leg));
  return { control, legs };
}

/** Удаление точки: соседние участки заменяются одним прямым. */
export function removePoint(path: EditablePath, index: number): EditablePath {
  if (index < 0 || index >= path.control.length) return path;
  const control = path.control.filter((_, i) => i !== index);
  if (control.length < 2) return { control, legs: [] };
  const legs: (number[] | null)[] = [];
  for (let i = 0; i < path.legs.length; i++) {
    if (index === 0) {
      if (i === 0) continue;
      legs.push(path.legs[i]!);
    } else if (index === path.control.length - 1) {
      if (i === path.legs.length - 1) continue;
      legs.push(path.legs[i]!);
    } else if (i === index - 1) {
      legs.push(null);
    } else if (i === index) {
      continue;
    } else {
      legs.push(path.legs[i]!);
    }
  }
  return { control, legs };
}

/** Вставка точки в середину участка (для перетаскивания «средней» ручки). */
export function insertPoint(path: EditablePath, afterIndex: number, point: LatLng): EditablePath {
  if (afterIndex < 0 || afterIndex >= path.control.length - 1) return path;
  const control = [...path.control.slice(0, afterIndex + 1), point, ...path.control.slice(afterIndex + 1)];
  const legs = [...path.legs.slice(0, afterIndex), null, null, ...path.legs.slice(afterIndex + 1)];
  return { control, legs };
}

export function reversePath(path: EditablePath): EditablePath {
  const control = [...path.control].reverse();
  const legs = [...path.legs].reverse().map((leg) => {
    if (!leg) return null;
    const pts = fromFlat(leg).reverse();
    return toFlat(pts);
  });
  return { control, legs };
}

/** Замыкает маршрут в кольцо: добавляет первую точку в конец. */
export function closePath(path: EditablePath): EditablePath {
  if (path.control.length < 3) return path;
  const first = path.control[0]!;
  const last = path.control[path.control.length - 1]!;
  if (first.lat === last.lat && first.lng === last.lng) return path;
  return addPoint(path, first, null);
}

export function pathFromRoute(route: Route): EditablePath | null {
  if (!route.control || route.control.length < 2) return null;
  const control = fromFlat(route.control);
  const legs: (number[] | null)[] = [];
  for (let i = 0; i < control.length - 1; i++) legs.push(route.legs?.[i] ?? null);
  return { control, legs };
}

export interface RouteDraft {
  id: string;
  name: string;
  source: RouteSource;
  createdAt: number;
  updatedAt: number;
}

export function routeFromPath(draft: RouteDraft, path: EditablePath): Route {
  const coords = buildGeometry(path);
  return {
    ...draft,
    coords,
    control: toFlat(path.control),
    legs: path.legs.map((l) => (l ? [...l] : null)),
    distanceM: flatLength(coords),
    pointCount: flatCount(coords),
  };
}

/** Маршрут без опорных точек (импорт GPX, рисование от руки): только геометрия. */
export function routeFromGeometry(draft: RouteDraft, coords: number[]): Route {
  return { ...draft, coords, distanceM: flatLength(coords), pointCount: flatCount(coords) };
}

/**
 * Превращает геометрию в редактируемые опорные точки. Это сжатие с потерями:
 * форма упрощается до maxPoints точек, участки становятся прямыми.
 */
export function makeEditable(coords: readonly number[], maxPoints = MAX_EDITABLE_POINTS): EditablePath {
  const reduced = reduceToMaxPoints(coords, maxPoints);
  const control = fromFlat(reduced);
  return { control, legs: control.slice(1).map(() => null) };
}

/** Рисование от руки: сглаживает «дрожание» пальца и ограничивает число точек. */
export function finishFreehand(raw: readonly number[], maxPoints = 1500): number[] {
  if (flatCount(raw) < 2) return [...raw];
  const simplified = simplify(raw, 2);
  return reduceToMaxPoints(simplified, maxPoints);
}

export function duplicateRoute(route: Route, id: string, now: number, name?: string): Route {
  return {
    ...route,
    id,
    name: name ?? `${route.name} (копия)`,
    source: 'copy',
    createdAt: now,
    updatedAt: now,
    coords: [...route.coords],
    control: route.control ? [...route.control] : undefined,
    legs: route.legs ? route.legs.map((l) => (l ? [...l] : null)) : undefined,
  };
}

export function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Индекс участка (control[i] → control[i+1]), ближайшего к точке p. Для вставки точки касанием по линии. */
export function nearestLegIndex(path: EditablePath, p: LatLng): number {
  const { control } = path;
  if (control.length < 2) return -1;
  const kx = Math.cos((p.lat * Math.PI) / 180);
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < control.length - 1; i++) {
    const a = control[i]!;
    const b = control[i + 1]!;
    const ax = a.lng * kx;
    const ay = a.lat;
    const dx = b.lng * kx - ax;
    const dy = b.lat - ay;
    const len2 = dx * dx + dy * dy;
    const px = p.lng * kx - ax;
    const py = p.lat - ay;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
    const d = Math.hypot(px - t * dx, py - t * dy);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}
