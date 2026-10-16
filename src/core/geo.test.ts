import { describe, expect, it } from 'vitest';
import {
  Path, bearing, dedupeConsecutive, flatBounds, flatLength, fromFlat, haversine, isValidLatLng, joinFlat,
  mapDistanceToRoute, pathLength, reduceToMaxPoints, simplify, toFlat, toleranceForZoom,
} from './geo';

describe('haversine', () => {
  it('одна точка — нулевое расстояние', () => {
    expect(haversine(55.75, 37.61, 55.75, 37.61)).toBe(0);
  });
  it('1° долготы на экваторе ≈ 111,19 км', () => {
    expect(haversine(0, 0, 0, 1)).toBeCloseTo(111_195, -2);
  });
  it('1° широты ≈ 111,19 км', () => {
    expect(haversine(10, 20, 11, 20)).toBeCloseTo(111_195, -2);
  });
  it('Москва — Санкт-Петербург ≈ 634 км', () => {
    const d = haversine(55.7558, 37.6173, 59.9343, 30.3351);
    expect(d / 1000).toBeGreaterThan(630);
    expect(d / 1000).toBeLessThan(638);
  });
  it('симметрично', () => {
    expect(haversine(10, 20, 30, 40)).toBeCloseTo(haversine(30, 40, 10, 20), 6);
  });
  it('корректно через 180-й меридиан', () => {
    expect(haversine(0, 179.5, 0, -179.5)).toBeCloseTo(111_195, -2);
  });
  it('порядок аргументов: широта, долгота (не перепутаны)', () => {
    // 1° по широте и по долготе на 60° с.ш. сильно различаются
    const dLat = haversine(60, 0, 61, 0);
    const dLng = haversine(60, 0, 60, 1);
    expect(dLat).toBeGreaterThan(dLng * 1.9);
  });
});

describe('isValidLatLng', () => {
  it('принимает границы и отклоняет мусор', () => {
    expect(isValidLatLng(90, 180)).toBe(true);
    expect(isValidLatLng(-90, -180)).toBe(true);
    expect(isValidLatLng(91, 0)).toBe(false);
    expect(isValidLatLng(0, 181)).toBe(false);
    expect(isValidLatLng(NaN, 0)).toBe(false);
    expect(isValidLatLng(0, Infinity)).toBe(false);
  });
});

describe('плоские массивы', () => {
  const pts = [{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }];
  it('toFlat / fromFlat обратимы', () => {
    expect(toFlat(pts)).toEqual([1, 2, 3, 4]);
    expect(fromFlat([1, 2, 3, 4])).toEqual(pts);
  });
  it('fromFlat игнорирует «хвост» без пары', () => {
    expect(fromFlat([1, 2, 3])).toEqual([{ lat: 1, lng: 2 }]);
  });
  it('flatLength совпадает с pathLength', () => {
    const p = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 }];
    expect(flatLength(toFlat(p))).toBeCloseTo(pathLength(p), 6);
  });
  it('длина пустой и одноточечной линии — 0', () => {
    expect(flatLength([])).toBe(0);
    expect(flatLength([1, 1])).toBe(0);
  });
  it('joinFlat не дублирует стыковую точку', () => {
    expect(joinFlat([[0, 0, 1, 1], [1, 1, 2, 2]])).toEqual([0, 0, 1, 1, 2, 2]);
    expect(joinFlat([[0, 0, 1, 1], [3, 3, 4, 4]])).toEqual([0, 0, 1, 1, 3, 3, 4, 4]);
  });
  it('dedupeConsecutive убирает повторы подряд', () => {
    expect(dedupeConsecutive([1, 1, 1, 1, 2, 2, 1, 1])).toEqual([1, 1, 2, 2, 1, 1]);
  });
  it('flatBounds', () => {
    expect(flatBounds([1, 5, 3, 2])).toEqual({ south: 1, north: 3, west: 2, east: 5 });
    expect(flatBounds([])).toBeNull();
  });
});

describe('Path', () => {
  // ~111 км на север по меридиану, две равные половины
  const flat = [0, 0, 0.5, 0, 1, 0];
  const path = new Path(flat);
  it('длина и накопленные расстояния', () => {
    expect(path.length).toBeCloseTo(111_195, -2);
    expect(path.cumulative[1]).toBeCloseTo(path.length / 2, 3);
  });
  it('точка в начале, середине и конце', () => {
    expect(path.pointAt(0)).toMatchObject({ lat: 0, lng: 0 });
    expect(path.pointAt(path.length / 2)!.lat).toBeCloseTo(0.5, 6);
    expect(path.pointAt(path.length)!.lat).toBeCloseTo(1, 6);
  });
  it('расстояние вне диапазона ограничивается', () => {
    expect(path.pointAt(-5)!.lat).toBe(0);
    expect(path.pointAt(1e9)!.lat).toBeCloseTo(1, 6);
  });
  it('интерполяция внутри сегмента и направление на север', () => {
    const p = path.pointAt(path.length / 4)!;
    expect(p.lat).toBeCloseTo(0.25, 6);
    expect(p.bearing).toBeCloseTo(0, 3);
  });
  it('пустой и одноточечный путь', () => {
    expect(new Path([]).pointAt(10)).toBeNull();
    expect(new Path([5, 6]).pointAt(10)).toMatchObject({ lat: 5, lng: 6 });
  });
  it('sliceTo возвращает пройденную часть с интерполированным концом', () => {
    const part = path.sliceTo(path.length * 0.75);
    expect(part.length).toBe(6);
    expect(part[4]).toBeCloseTo(0.75, 6);
  });
  it('бинарный поиск работает на 100 000 точек', () => {
    const big: number[] = [];
    for (let i = 0; i < 100_000; i++) big.push(i * 1e-5, 0);
    const bigPath = new Path(big);
    const mid = bigPath.pointAt(bigPath.length / 2)!;
    expect(mid.lat).toBeCloseTo(0.5, 3);
  });
});

describe('bearing', () => {
  it('стороны света', () => {
    expect(bearing(0, 0, 1, 0)).toBeCloseTo(0, 3);
    expect(bearing(0, 0, 0, 1)).toBeCloseTo(90, 3);
    expect(bearing(1, 0, 0, 0)).toBeCloseTo(180, 3);
    expect(bearing(0, 1, 0, 0)).toBeCloseTo(270, 3);
  });
});

describe('mapDistanceToRoute', () => {
  it('без повторов упирается в конец', () => {
    expect(mapDistanceToRoute(150, 100, 'none')).toBe(100);
  });
  it('loop начинает заново', () => {
    expect(mapDistanceToRoute(150, 100, 'loop')).toBe(50);
  });
  it('pingpong идёт обратно', () => {
    expect(mapDistanceToRoute(150, 100, 'pingpong')).toBe(50);
    expect(mapDistanceToRoute(250, 100, 'pingpong')).toBe(50);
    expect(mapDistanceToRoute(200, 100, 'pingpong')).toBe(0);
  });
  it('внутри маршрута возвращает как есть, отрицательное → 0, нулевая длина → 0', () => {
    expect(mapDistanceToRoute(40, 100, 'loop')).toBe(40);
    expect(mapDistanceToRoute(-3, 100, 'none')).toBe(0);
    expect(mapDistanceToRoute(40, 0, 'loop')).toBe(0);
  });
});

describe('simplify / reduceToMaxPoints', () => {
  it('сохраняет концы и убирает точки на одной линии', () => {
    const line = [0, 0, 0.001, 0, 0.002, 0, 0.003, 0];
    expect(simplify(line, 1)).toEqual([0, 0, 0.003, 0]);
  });
  it('сохраняет значимый излом', () => {
    const bend = [0, 0, 0.01, 0.01, 0, 0.02];
    expect(simplify(bend, 5)).toEqual(bend);
  });
  it('нулевой допуск ничего не меняет', () => {
    const a = [0, 0, 0.001, 0.0005, 0.002, 0];
    expect(simplify(a, 0)).toEqual(a);
  });
  it('reduceToMaxPoints укладывается в лимит и сохраняет концы (20 000 точек)', () => {
    const noisy: number[] = [];
    for (let i = 0; i < 20_000; i++) noisy.push(i * 1e-5, Math.sin(i / 50) * 1e-3);
    const reduced = reduceToMaxPoints(noisy, 300);
    expect(reduced.length / 2).toBeLessThanOrEqual(300);
    expect(reduced[0]).toBe(noisy[0]);
    expect(reduced[reduced.length - 2]).toBe(noisy[noisy.length - 2]);
  });
  it('короткую линию не трогает', () => {
    expect(reduceToMaxPoints([0, 0, 1, 1], 10)).toEqual([0, 0, 1, 1]);
  });
  it('допуск для отрисовки уменьшается с ростом масштаба', () => {
    expect(toleranceForZoom(10, 55)).toBeGreaterThan(toleranceForZoom(16, 55));
  });
});
