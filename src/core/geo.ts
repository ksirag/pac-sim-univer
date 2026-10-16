import type { LatLng, RepeatMode } from './types';

export const EARTH_RADIUS_M = 6371008.8;
const RAD = Math.PI / 180;

export function isValidLatLng(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/** Расстояние между двумя точками по формуле гаверсинусов, метры. */
export function haversine(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = (bLat - aLat) * RAD;
  const dLng = (bLng - aLng) * RAD;
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const h = s1 * s1 + Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * s2 * s2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function distanceBetween(a: LatLng, b: LatLng): number {
  return haversine(a.lat, a.lng, b.lat, b.lng);
}

export function toFlat(points: readonly LatLng[]): number[] {
  const out = new Array<number>(points.length * 2);
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    out[i * 2] = p.lat;
    out[i * 2 + 1] = p.lng;
  }
  return out;
}

export function fromFlat(flat: readonly number[]): LatLng[] {
  const out: LatLng[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ lat: flat[i]!, lng: flat[i + 1]! });
  return out;
}

export function flatCount(flat: readonly number[]): number {
  return Math.floor(flat.length / 2);
}

/** Длина ломаной, заданной плоским массивом, метры. */
export function flatLength(flat: readonly number[]): number {
  let total = 0;
  for (let i = 2; i + 1 < flat.length; i += 2) {
    total += haversine(flat[i - 2]!, flat[i - 1]!, flat[i]!, flat[i + 1]!);
  }
  return total;
}

export function pathLength(points: readonly LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distanceBetween(points[i - 1]!, points[i]!);
  return total;
}

/** Соединяет участки в одну ломаную без дублирования стыковых точек. */
export function joinFlat(parts: readonly (readonly number[])[]): number[] {
  const out: number[] = [];
  for (const part of parts) {
    let start = 0;
    if (out.length >= 2 && part.length >= 2) {
      const sameLat = out[out.length - 2] === part[0];
      const sameLng = out[out.length - 1] === part[1];
      if (sameLat && sameLng) start = 2;
    }
    for (let i = start; i < part.length; i++) out.push(part[i]!);
  }
  return out;
}

export interface PointOnPath extends LatLng {
  /** Направление движения, градусы от севера по часовой. */
  bearing: number;
}

/**
 * Путь с накопленными расстояниями: позволяет быстро найти точку на заданной дистанции
 * (бинарный поиск), в том числе на маршрутах из десятков тысяч точек.
 */
export class Path {
  readonly flat: readonly number[];
  readonly cumulative: Float64Array;
  readonly length: number;
  readonly count: number;

  constructor(flat: readonly number[]) {
    this.flat = flat;
    this.count = flatCount(flat);
    this.cumulative = new Float64Array(this.count);
    let total = 0;
    for (let i = 1; i < this.count; i++) {
      total += haversine(flat[(i - 1) * 2]!, flat[(i - 1) * 2 + 1]!, flat[i * 2]!, flat[i * 2 + 1]!);
      this.cumulative[i] = total;
    }
    this.length = total;
  }

  /** Точка на расстоянии d метров от начала (d ограничивается длиной пути). */
  pointAt(d: number): PointOnPath | null {
    if (this.count === 0) return null;
    if (this.count === 1) return { lat: this.flat[0]!, lng: this.flat[1]!, bearing: 0 };
    const dist = Math.min(Math.max(d, 0), this.length);
    let lo = 0;
    let hi = this.count - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cumulative[mid]! <= dist) lo = mid;
      else hi = mid;
    }
    const segLen = this.cumulative[hi]! - this.cumulative[lo]!;
    const t = segLen > 0 ? (dist - this.cumulative[lo]!) / segLen : 0;
    const aLat = this.flat[lo * 2]!;
    const aLng = this.flat[lo * 2 + 1]!;
    const bLat = this.flat[hi * 2]!;
    const bLng = this.flat[hi * 2 + 1]!;
    return { lat: aLat + (bLat - aLat) * t, lng: aLng + (bLng - aLng) * t, bearing: bearing(aLat, aLng, bLat, bLng) };
  }

  /** Часть пути от начала до расстояния d (плоский массив), с интерполированной последней точкой. */
  sliceTo(d: number): number[] {
    if (this.count === 0) return [];
    const dist = Math.min(Math.max(d, 0), this.length);
    const out: number[] = [];
    for (let i = 0; i < this.count; i++) {
      if (this.cumulative[i]! > dist) break;
      out.push(this.flat[i * 2]!, this.flat[i * 2 + 1]!);
    }
    const end = this.pointAt(dist);
    if (end && (out[out.length - 2] !== end.lat || out[out.length - 1] !== end.lng)) out.push(end.lat, end.lng);
    return out;
  }
}

export function bearing(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const y = Math.sin((bLng - aLng) * RAD) * Math.cos(bLat * RAD);
  const x =
    Math.cos(aLat * RAD) * Math.sin(bLat * RAD) -
    Math.sin(aLat * RAD) * Math.cos(bLat * RAD) * Math.cos((bLng - aLng) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

/**
 * Переводит пройденную дистанцию в положение вдоль маршрута длиной routeLength.
 * Если дистанция больше длины маршрута, маршрут проходится заново (loop)
 * или в обратную сторону (pingpong); при 'none' упирается в конец.
 */
export function mapDistanceToRoute(distance: number, routeLength: number, repeat: RepeatMode): number {
  if (routeLength <= 0) return 0;
  if (distance <= routeLength || repeat === 'none') return Math.min(Math.max(distance, 0), routeLength);
  if (repeat === 'loop') return distance % routeLength;
  const cycle = routeLength * 2;
  const m = distance % cycle;
  return m <= routeLength ? m : cycle - m;
}

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export function flatBounds(flat: readonly number[]): Bounds | null {
  if (flat.length < 2) return null;
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const lat = flat[i]!;
    const lng = flat[i + 1]!;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (lng < west) west = lng;
    if (lng > east) east = lng;
  }
  return { south, west, north, east };
}

/**
 * Упрощение ломаной алгоритмом Дугласа–Пекера (итеративный, без рекурсии,
 * поэтому безопасен для очень больших треков). Допуск — метры.
 */
export function simplify(flat: readonly number[], toleranceM: number): number[] {
  const n = flatCount(flat);
  if (n <= 2 || toleranceM <= 0) return [...flat];
  const midLat = (flat[0]! + flat[Math.floor(n / 2) * 2]! + flat[(n - 1) * 2]!) / 3;
  const kx = Math.cos(midLat * RAD) * EARTH_RADIUS_M * RAD;
  const ky = EARTH_RADIUS_M * RAD;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = flat[i * 2 + 1]! * kx;
    ys[i] = flat[i * 2]! * ky;
  }
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: number[] = [0, n - 1];
  while (stack.length) {
    const end = stack.pop()!;
    const start = stack.pop()!;
    let maxDist = 0;
    let index = -1;
    const ax = xs[start]!;
    const ay = ys[start]!;
    const dx = xs[end]! - ax;
    const dy = ys[end]! - ay;
    const len2 = dx * dx + dy * dy;
    for (let i = start + 1; i < end; i++) {
      let d: number;
      if (len2 === 0) {
        d = Math.hypot(xs[i]! - ax, ys[i]! - ay);
      } else {
        const t = Math.max(0, Math.min(1, ((xs[i]! - ax) * dx + (ys[i]! - ay) * dy) / len2));
        d = Math.hypot(xs[i]! - (ax + t * dx), ys[i]! - (ay + t * dy));
      }
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (index !== -1 && maxDist > toleranceM) {
      keep[index] = 1;
      stack.push(start, index, index, end);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(flat[i * 2]!, flat[i * 2 + 1]!);
  return out;
}

/** Упрощает ломаную так, чтобы точек стало не больше maxPoints. */
export function reduceToMaxPoints(flat: readonly number[], maxPoints: number): number[] {
  if (flatCount(flat) <= maxPoints) return [...flat];
  let tolerance = 1;
  let result: number[] = [...flat];
  for (let i = 0; i < 24 && flatCount(result) > maxPoints; i++) {
    result = simplify(flat, tolerance);
    tolerance *= 1.8;
  }
  if (flatCount(result) > maxPoints) {
    // крайний случай: равномерная выборка
    const step = flatCount(result) / maxPoints;
    const sampled: number[] = [];
    for (let i = 0; i < maxPoints - 1; i++) {
      const idx = Math.floor(i * step);
      sampled.push(result[idx * 2]!, result[idx * 2 + 1]!);
    }
    sampled.push(result[result.length - 2]!, result[result.length - 1]!);
    result = sampled;
  }
  return result;
}

/** Допуск упрощения для отрисовки на заданном масштабе карты (метров на пиксель × запас). */
export function toleranceForZoom(zoom: number, latitude: number): number {
  const metersPerPixel = (156543.03392 * Math.cos(latitude * RAD)) / Math.pow(2, zoom);
  return Math.max(0.5, metersPerPixel * 1.5);
}

/** Удаляет подряд идущие одинаковые точки. */
export function dedupeConsecutive(flat: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const lat = flat[i]!;
    const lng = flat[i + 1]!;
    if (out.length >= 2 && out[out.length - 2] === lat && out[out.length - 1] === lng) continue;
    out.push(lat, lng);
  }
  return out;
}
