import { describe, expect, it } from 'vitest';
import {
  EMPTY_PATH, addPoint, buildGeometry, closePath, duplicateRoute, finishFreehand, insertPoint, makeEditable, movePoint,
  nearestLegIndex, newId, pathFromRoute, removePoint, reversePath, routeFromGeometry, routeFromPath, type EditablePath,
} from './routeModel';
import { flatLength } from './geo';

const P = (lat: number, lng: number) => ({ lat, lng });
const build = (...pts: [number, number][]): EditablePath => pts.reduce((acc, [a, b]) => addPoint(acc, P(a, b)), EMPTY_PATH);
const invariant = (p: EditablePath) => expect(p.legs.length).toBe(Math.max(0, p.control.length - 1));

describe('редактирование точек', () => {
  it('добавление поддерживает инвариант legs = control − 1', () => {
    let p = EMPTY_PATH;
    for (let i = 0; i < 5; i++) {
      p = addPoint(p, P(i, i));
      invariant(p);
    }
    expect(p.control).toHaveLength(5);
  });
  it('геометрия из прямых участков', () => {
    expect(buildGeometry(build([0, 0], [0, 1], [1, 1]))).toEqual([0, 0, 0, 1, 1, 1]);
    expect(buildGeometry(build([5, 5]))).toEqual([5, 5]);
    expect(buildGeometry(EMPTY_PATH)).toEqual([]);
  });
  it('участок по улицам попадает в геометрию без дублирования стыков', () => {
    let p = addPoint(EMPTY_PATH, P(0, 0));
    p = addPoint(p, P(1, 1), [0, 0, 0.5, 0.2, 1, 1]);
    p = addPoint(p, P(2, 2));
    expect(buildGeometry(p)).toEqual([0, 0, 0.5, 0.2, 1, 1, 2, 2]);
  });
  it('перемещение сбрасывает соседние участки в прямые', () => {
    let p = addPoint(EMPTY_PATH, P(0, 0));
    p = addPoint(p, P(1, 1), [0, 0, 0.5, 0.2, 1, 1]);
    p = addPoint(p, P(2, 2), [1, 1, 1.5, 1.2, 2, 2]);
    p = addPoint(p, P(3, 3), [2, 2, 2.5, 2.2, 3, 3]);
    const moved = movePoint(p, 1, P(1.1, 1.1));
    expect(moved.legs[0]).toBeNull();
    expect(moved.legs[1]).toBeNull();
    expect(moved.legs[2]).not.toBeNull();
    expect(moved.control[1]).toEqual(P(1.1, 1.1));
    invariant(moved);
  });
  it('перемещение вне диапазона ничего не делает', () => {
    const p = build([0, 0], [1, 1]);
    expect(movePoint(p, 7, P(9, 9))).toBe(p);
  });
  it('удаление начальной, конечной и средней точки', () => {
    const p = build([0, 0], [1, 1], [2, 2], [3, 3]);
    for (const i of [0, 1, 2, 3]) {
      const r = removePoint(p, i);
      expect(r.control).toHaveLength(3);
      invariant(r);
    }
    expect(removePoint(p, 0).control[0]).toEqual(P(1, 1));
    expect(removePoint(p, 3).control[2]).toEqual(P(2, 2));
  });
  it('при удалении до одной точки участков нет', () => {
    const p = removePoint(build([0, 0], [1, 1]), 0);
    expect(p.control).toHaveLength(1);
    expect(p.legs).toEqual([]);
  });
  it('удаление средней точки заменяет два участка одним прямым', () => {
    let p = addPoint(EMPTY_PATH, P(0, 0));
    p = addPoint(p, P(1, 1), [0, 0, 0.5, 0.2, 1, 1]);
    p = addPoint(p, P(2, 2), [1, 1, 1.5, 1.2, 2, 2]);
    p = addPoint(p, P(3, 3), [2, 2, 2.5, 2.2, 3, 3]);
    const r = removePoint(p, 1);
    expect(r.legs).toEqual([null, [2, 2, 2.5, 2.2, 3, 3]]);
  });
  it('вставка точки в середину участка', () => {
    const p = build([0, 0], [2, 2]);
    const r = insertPoint(p, 0, P(1, 1));
    expect(r.control.map((c) => c.lat)).toEqual([0, 1, 2]);
    invariant(r);
    expect(insertPoint(p, 5, P(9, 9))).toBe(p);
  });
  it('разворот маршрута', () => {
    let p = addPoint(EMPTY_PATH, P(0, 0));
    p = addPoint(p, P(1, 1), [0, 0, 0.4, 0.6, 1, 1]);
    const r = reversePath(p);
    expect(r.control).toEqual([P(1, 1), P(0, 0)]);
    expect(r.legs[0]).toEqual([1, 1, 0.4, 0.6, 0, 0]);
  });
  it('замыкание в кольцо', () => {
    const p = build([0, 0], [0, 1], [1, 1]);
    const c = closePath(p);
    expect(c.control).toHaveLength(4);
    expect(c.control[3]).toEqual(P(0, 0));
    expect(closePath(c)).toBe(c); // уже замкнут
    expect(closePath(build([0, 0], [1, 1]))).toEqual(build([0, 0], [1, 1])); // меньше трёх точек
    invariant(c);
  });
});

describe('маршрут из точек и из геометрии', () => {
  const draft = { id: 'r', name: 'М', source: 'drawn' as const, createdAt: 1, updatedAt: 2 };
  it('routeFromPath пересчитывает длину и число точек', () => {
    const route = routeFromPath(draft, build([0, 0], [0, 1], [1, 1]));
    expect(route.distanceM).toBeCloseTo(flatLength([0, 0, 0, 1, 1, 1]), 6);
    expect(route.pointCount).toBe(3);
    expect(route.control).toEqual([0, 0, 0, 1, 1, 1]);
    expect(route.legs).toHaveLength(2);
  });
  it('pathFromRoute восстанавливает редактируемое состояние', () => {
    const route = routeFromPath(draft, build([0, 0], [0, 1], [1, 1]));
    const back = pathFromRoute(route)!;
    expect(back.control).toHaveLength(3);
    invariant(back);
  });
  it('у импортированного трека редактируемого состояния нет', () => {
    const route = routeFromGeometry({ ...draft, source: 'gpx' }, [0, 0, 1, 1]);
    expect(pathFromRoute(route)).toBeNull();
  });
  it('makeEditable ограничивает число опорных точек', () => {
    const coords: number[] = [];
    for (let i = 0; i < 5000; i++) coords.push(i * 1e-4, Math.sin(i / 20) * 1e-3);
    const p = makeEditable(coords, 100);
    expect(p.control.length).toBeLessThanOrEqual(100);
    invariant(p);
  });
  it('finishFreehand сглаживает дрожание и ограничивает размер', () => {
    const raw: number[] = [];
    for (let i = 0; i < 4000; i++) raw.push(i * 2e-5, 1e-6 * (i % 2));
    const out = finishFreehand(raw, 500);
    expect(out.length / 2).toBeLessThan(10);
    expect(out[0]).toBe(raw[0]);
  });
  it('копия не делит массивы с оригиналом', () => {
    const route = routeFromPath(draft, build([0, 0], [1, 1]));
    const copy = duplicateRoute(route, 'copy', 99);
    expect(copy.id).toBe('copy');
    expect(copy.name).toBe('М (копия)');
    expect(copy.source).toBe('copy');
    copy.coords[0] = 42;
    expect(route.coords[0]).toBe(0);
  });
  it('newId уникален', () => {
    expect(new Set(Array.from({ length: 200 }, () => newId())).size).toBe(200);
  });
});

describe('nearestLegIndex', () => {
  const p = build([0, 0], [0, 1], [1, 1], [1, 2]);
  it('находит ближайший участок', () => {
    expect(nearestLegIndex(p, P(0.01, 0.5))).toBe(0);
    expect(nearestLegIndex(p, P(0.5, 1.02))).toBe(1);
    expect(nearestLegIndex(p, P(1.01, 1.5))).toBe(2);
  });
  it('меньше двух точек — -1', () => {
    expect(nearestLegIndex(build([0, 0]), P(1, 1))).toBe(-1);
  });
});
