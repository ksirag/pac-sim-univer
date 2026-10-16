import { describe, expect, it, vi } from 'vitest';
import {
  GuardedRouting, OsrmAdapter, RoutingError, createRoutingAdapter, isHttpsUrl, parseOsrmResponse, routeLegWithFallback,
  type RoutingAdapter,
} from './routing';
import { DEFAULT_SETTINGS } from './types';

const A = { lat: 55.75, lng: 37.6 };
const B = { lat: 55.76, lng: 37.62 };

const okBody = { code: 'Ok', routes: [{ geometry: { coordinates: [[37.6, 55.75], [37.61, 55.755], [37.62, 55.76]] } }] };
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('parseOsrmResponse', () => {
  it('переворачивает [долгота, широта] в (широта, долгота)', () => {
    expect(parseOsrmResponse(okBody)).toEqual([55.75, 37.6, 55.755, 37.61, 55.76, 37.62]);
  });
  it('NoRoute → no_route', () => {
    expect(() => parseOsrmResponse({ code: 'NoRoute' })).toThrow(expect.objectContaining({ code: 'no_route' }));
  });
  it.each([null, 'x', {}, { code: 'Ok' }, { code: 'Ok', routes: [] }, { code: 'Ok', routes: [{ geometry: { coordinates: [[1, 2]] } }] },
    { code: 'Ok', routes: [{ geometry: { coordinates: [[1, 2], [200, 100]] } }] }])('мусор → bad_response (%#)', (body) => {
    expect(() => parseOsrmResponse(body)).toThrow(expect.objectContaining({ code: 'bad_response' }));
  });
});

describe('OsrmAdapter', () => {
  it('формирует URL с координатами «долгота,широта» и разбирает ответ', async () => {
    const fetchImpl = vi.fn(async (..._args: unknown[]) => jsonResponse(okBody));
    const a = new OsrmAdapter({ baseUrl: 'https://example.test/r/', profile: 'foot', fetchImpl: fetchImpl as unknown as typeof fetch });
    const coords = await a.route(A, B);
    const url = String(fetchImpl.mock.calls[0]![0]);
    expect(url).toBe('https://example.test/r/route/v1/foot/37.6,55.75;37.62,55.76?overview=full&geometries=geojson&steps=false');
    expect(coords).toHaveLength(6);
  });
  it('429 → rate_limit', async () => {
    const a = new OsrmAdapter({ baseUrl: 'https://x.test', profile: 'foot', fetchImpl: (async () => jsonResponse({}, 429)) as unknown as typeof fetch });
    await expect(a.route(A, B)).rejects.toMatchObject({ code: 'rate_limit' });
  });
  it('5xx → unavailable', async () => {
    const a = new OsrmAdapter({ baseUrl: 'https://x.test', profile: 'foot', fetchImpl: (async () => jsonResponse({}, 503)) as unknown as typeof fetch });
    await expect(a.route(A, B)).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('сетевая ошибка → unavailable', async () => {
    const a = new OsrmAdapter({ baseUrl: 'https://x.test', profile: 'foot', fetchImpl: (async () => { throw new TypeError('network'); }) as unknown as typeof fetch });
    await expect(a.route(A, B)).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('не JSON → bad_response', async () => {
    const a = new OsrmAdapter({ baseUrl: 'https://x.test', profile: 'foot', fetchImpl: (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch });
    await expect(a.route(A, B)).rejects.toMatchObject({ code: 'bad_response' });
  });
  it('таймаут → timeout', async () => {
    const hanging = ((_u: string, init?: RequestInit) =>
      new Promise((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
      })) as unknown as typeof fetch;
    const a = new OsrmAdapter({ baseUrl: 'https://x.test', profile: 'foot', timeoutMs: 20, fetchImpl: hanging });
    await expect(a.route(A, B)).rejects.toMatchObject({ code: 'timeout' });
  });
  it('внешняя отмена → aborted', async () => {
    const hanging = ((_u: string, init?: RequestInit) =>
      new Promise((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
      })) as unknown as typeof fetch;
    const a = new OsrmAdapter({ baseUrl: 'https://x.test', profile: 'foot', timeoutMs: 5000, fetchImpl: hanging });
    const ctl = new AbortController();
    const p = a.route(A, B, ctl.signal);
    ctl.abort();
    await expect(p).rejects.toMatchObject({ code: 'aborted' });
  });
});

describe('GuardedRouting', () => {
  const failing: RoutingAdapter & { calls: number } = {
    id: 'f', label: 'f', calls: 0,
    async route() { this.calls += 1; throw new RoutingError('unavailable', 'x'); },
  };
  it('после серии ошибок временно отключается и не обращается к сервису', async () => {
    let now = 1000;
    const g = new GuardedRouting(failing, { minIntervalMs: 0, failureThreshold: 3, cooldownMs: 60_000, now: () => now, sleep: async () => {} });
    for (let i = 0; i < 3; i++) await expect(g.route(A, B)).rejects.toMatchObject({ code: 'unavailable' });
    expect(g.isDisabled).toBe(true);
    await expect(g.route(A, B)).rejects.toMatchObject({ code: 'disabled' });
    expect(failing.calls).toBe(3);
    now += 61_000;
    expect(g.isDisabled).toBe(false);
    await expect(g.route(A, B)).rejects.toMatchObject({ code: 'unavailable' });
    expect(failing.calls).toBe(4);
  });
  it('«нет маршрута» не считается сбоем сервиса', async () => {
    const noRoute: RoutingAdapter = { id: 'n', label: 'n', async route() { throw new RoutingError('no_route', 'x'); } };
    const g = new GuardedRouting(noRoute, { minIntervalMs: 0, failureThreshold: 2, now: () => 0, sleep: async () => {} });
    for (let i = 0; i < 5; i++) await expect(g.route(A, B)).rejects.toMatchObject({ code: 'no_route' });
    expect(g.isDisabled).toBe(false);
  });
  it('успех сбрасывает счётчик ошибок', async () => {
    let fail = true;
    const flaky: RoutingAdapter = { id: 'x', label: 'x', async route() { if (fail) throw new RoutingError('timeout', 'x'); return [1, 1, 2, 2]; } };
    const g = new GuardedRouting(flaky, { minIntervalMs: 0, failureThreshold: 3, now: () => 0, sleep: async () => {} });
    await expect(g.route(A, B)).rejects.toBeTruthy();
    await expect(g.route(A, B)).rejects.toBeTruthy();
    fail = false;
    await expect(g.route(A, B)).resolves.toBeTruthy();
    fail = true;
    await expect(g.route(A, B)).rejects.toBeTruthy();
    await expect(g.route(A, B)).rejects.toBeTruthy();
    expect(g.isDisabled).toBe(false);
  });
  it('выдерживает паузу между запросами и выполняет их последовательно', async () => {
    const order: string[] = [];
    let now = 0;
    const inner: RoutingAdapter = { id: 'i', label: 'i', async route(f) { order.push(`start${f.lat}`); await Promise.resolve(); order.push(`end${f.lat}`); return [1, 1, 2, 2]; } };
    const sleeps: number[] = [];
    const g = new GuardedRouting(inner, { minIntervalMs: 400, now: () => now, sleep: async (ms) => { sleeps.push(ms); now += ms; } });
    await Promise.all([g.route({ lat: 1, lng: 1 }, B), g.route({ lat: 2, lng: 1 }, B)]);
    expect(order).toEqual(['start1', 'end1', 'start2', 'end2']);
    expect(sleeps.some((s) => s > 0)).toBe(true);
  });
  it('уже отменённый запрос не уходит в сервис', async () => {
    const inner: RoutingAdapter = { id: 'i', label: 'i', route: vi.fn(async () => [1, 1, 2, 2]) };
    const g = new GuardedRouting(inner, { minIntervalMs: 0, now: () => 0, sleep: async () => {} });
    const ctl = new AbortController();
    ctl.abort();
    await expect(g.route(A, B, ctl.signal)).rejects.toMatchObject({ code: 'aborted' });
    expect(inner.route).not.toHaveBeenCalled();
  });
});

describe('routeLegWithFallback', () => {
  it('без адаптера — прямая линия', async () => {
    expect(await routeLegWithFallback(null, A, B)).toEqual({ coords: [A.lat, A.lng, B.lat, B.lng], routed: false });
  });
  it('при ошибке сервиса — прямая линия и причина', async () => {
    const adapter: RoutingAdapter = { id: 'a', label: 'a', async route() { throw new RoutingError('timeout', 'x'); } };
    const r = await routeLegWithFallback(adapter, A, B);
    expect(r.routed).toBe(false);
    expect(r.coords).toEqual([A.lat, A.lng, B.lat, B.lng]);
    expect(r.error?.code).toBe('timeout');
  });
  it('неизвестная ошибка тоже даёт прямую линию', async () => {
    const adapter: RoutingAdapter = { id: 'a', label: 'a', async route() { throw new Error('boom'); } };
    const r = await routeLegWithFallback(adapter, A, B);
    expect(r.routed).toBe(false);
    expect(r.error?.code).toBe('unavailable');
  });
  it('успех: участок привязан к выбранным точкам на концах', async () => {
    const adapter: RoutingAdapter = { id: 'a', label: 'a', async route() { return [55.7501, 37.6001, 55.755, 37.61, 55.7599, 37.6199]; } };
    const r = await routeLegWithFallback(adapter, A, B);
    expect(r.routed).toBe(true);
    expect(r.coords.slice(0, 2)).toEqual([A.lat, A.lng]);
    expect(r.coords.slice(-2)).toEqual([B.lat, B.lng]);
  });
});

describe('createRoutingAdapter', () => {
  it('выключено → null', () => {
    expect(createRoutingAdapter({ ...DEFAULT_SETTINGS, routingEnabled: false })).toBeNull();
  });
  it('по умолчанию создаёт адаптер', () => {
    expect(createRoutingAdapter(DEFAULT_SETTINGS)).not.toBeNull();
  });
  it('свой сервер: нужен корректный https-адрес', () => {
    expect(createRoutingAdapter({ ...DEFAULT_SETTINGS, routingPreset: 'custom', routingCustomUrl: '' })).toBeNull();
    expect(createRoutingAdapter({ ...DEFAULT_SETTINGS, routingPreset: 'custom', routingCustomUrl: 'http://example.com' })).toBeNull();
    expect(createRoutingAdapter({ ...DEFAULT_SETTINGS, routingPreset: 'custom', routingCustomUrl: 'https://osrm.example.com' })).not.toBeNull();
  });
  it('isHttpsUrl разрешает http только для localhost', () => {
    expect(isHttpsUrl('https://a.b')).toBe(true);
    expect(isHttpsUrl('http://localhost:5000')).toBe(true);
    expect(isHttpsUrl('http://a.b')).toBe(false);
    expect(isHttpsUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpsUrl('нет')).toBe(false);
  });
});
