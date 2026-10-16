import { isValidLatLng, toFlat } from './geo';
import type { LatLng, Settings } from './types';

/**
 * Построение маршрута по улицам. Приложение НЕ зависит от маршрутизатора:
 * при любой ошибке (таймаут, лимит запросов, нет сети, нет маршрута) участок
 * строится прямой линией, и свободное редактирование продолжает работать.
 */

export type RoutingErrorCode = 'timeout' | 'rate_limit' | 'unavailable' | 'no_route' | 'bad_response' | 'offline' | 'aborted' | 'disabled';

export class RoutingError extends Error {
  readonly code: RoutingErrorCode;
  constructor(code: RoutingErrorCode, message: string) {
    super(message);
    this.name = 'RoutingError';
    this.code = code;
  }
}

export const ROUTING_ERROR_TEXT: Record<RoutingErrorCode, string> = {
  timeout: 'Сервис маршрутов не ответил вовремя',
  rate_limit: 'Сервис маршрутов ограничил число запросов',
  unavailable: 'Сервис маршрутов недоступен',
  no_route: 'Между этими точками не найден пеший маршрут',
  bad_response: 'Сервис маршрутов вернул непонятный ответ',
  offline: 'Нет подключения к интернету',
  aborted: 'Запрос отменён',
  disabled: 'Построение по улицам временно отключено из-за ошибок',
};

export interface RoutingAdapter {
  readonly id: string;
  readonly label: string;
  /** Плоская геометрия участка [lat, lng, …] от from до to. */
  route(from: LatLng, to: LatLng, signal?: AbortSignal): Promise<number[]>;
}

export interface OsrmOptions {
  baseUrl: string;
  profile: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Адаптер для OSRM-совместимого API (в т. ч. публичных демо-серверов — у них нет гарантий и есть лимиты). */
export class OsrmAdapter implements RoutingAdapter {
  readonly id: string;
  readonly label: string;
  private readonly baseUrl: string;
  private readonly profile: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OsrmOptions & { id?: string; label?: string }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.profile = options.profile;
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.id = options.id ?? 'osrm';
    this.label = options.label ?? 'OSRM';
  }

  async route(from: LatLng, to: LatLng, signal?: AbortSignal): Promise<number[]> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new RoutingError('offline', ROUTING_ERROR_TEXT.offline);
    }
    // OSRM принимает координаты как «долгота,широта» — порядок обратный нашему.
    const url = `${this.baseUrl}/route/v1/${encodeURIComponent(this.profile)}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=false`;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      let response: Response;
      try {
        response = await this.fetchImpl(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      } catch (error) {
        if (timedOut) throw new RoutingError('timeout', ROUTING_ERROR_TEXT.timeout);
        if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
          throw new RoutingError('aborted', ROUTING_ERROR_TEXT.aborted);
        }
        throw new RoutingError('unavailable', ROUTING_ERROR_TEXT.unavailable);
      }
      if (response.status === 429) throw new RoutingError('rate_limit', ROUTING_ERROR_TEXT.rate_limit);
      if (response.status >= 500) throw new RoutingError('unavailable', ROUTING_ERROR_TEXT.unavailable);

      let data: unknown;
      try {
        data = await response.json();
      } catch {
        if (timedOut) throw new RoutingError('timeout', ROUTING_ERROR_TEXT.timeout);
        throw new RoutingError('bad_response', ROUTING_ERROR_TEXT.bad_response);
      }
      return parseOsrmResponse(data);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

/** Разбор ответа OSRM. Экспортируется для тестов. */
export function parseOsrmResponse(data: unknown): number[] {
  const obj = data as { code?: string; routes?: { geometry?: { coordinates?: unknown } }[] } | null;
  if (!obj || typeof obj !== 'object') throw new RoutingError('bad_response', ROUTING_ERROR_TEXT.bad_response);
  if (obj.code === 'NoRoute' || obj.code === 'NoSegment') throw new RoutingError('no_route', ROUTING_ERROR_TEXT.no_route);
  if (obj.code !== 'Ok') throw new RoutingError('bad_response', ROUTING_ERROR_TEXT.bad_response);
  const coords = obj.routes?.[0]?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) throw new RoutingError('bad_response', ROUTING_ERROR_TEXT.bad_response);
  const points: LatLng[] = [];
  for (const c of coords) {
    if (!Array.isArray(c)) throw new RoutingError('bad_response', ROUTING_ERROR_TEXT.bad_response);
    const lng = Number(c[0]);
    const lat = Number(c[1]);
    if (!isValidLatLng(lat, lng)) throw new RoutingError('bad_response', ROUTING_ERROR_TEXT.bad_response);
    points.push({ lat, lng });
  }
  return toFlat(points);
}

export interface GuardOptions {
  /** Минимальный интервал между запросами к сервису, мс. */
  minIntervalMs?: number;
  /** Сколько ошибок подряд приводят к временному отключению. */
  failureThreshold?: number;
  /** На сколько отключаем после серии ошибок, мс. */
  cooldownMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Защита сервиса и приложения: последовательные запросы с паузой между ними (вежливое
 * использование публичных серверов) и «предохранитель»: после серии ошибок запросы
 * временно не отправляются, чтобы свободное рисование не тормозило.
 */
export class GuardedRouting implements RoutingAdapter {
  readonly id: string;
  readonly label: string;
  private lastStart = 0;
  private failures = 0;
  private disabledUntil = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly minInterval: number;
  private readonly threshold: number;
  private readonly cooldown: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly inner: RoutingAdapter,
    options: GuardOptions = {},
  ) {
    this.id = inner.id;
    this.label = inner.label;
    this.minInterval = options.minIntervalMs ?? 400;
    this.threshold = options.failureThreshold ?? 3;
    this.cooldown = options.cooldownMs ?? 60_000;
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get isDisabled(): boolean {
    return this.now() < this.disabledUntil;
  }

  route(from: LatLng, to: LatLng, signal?: AbortSignal): Promise<number[]> {
    const run = async () => {
      if (this.isDisabled) throw new RoutingError('disabled', ROUTING_ERROR_TEXT.disabled);
      if (signal?.aborted) throw new RoutingError('aborted', ROUTING_ERROR_TEXT.aborted);
      const wait = this.lastStart + this.minInterval - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastStart = this.now();
      try {
        const result = await this.inner.route(from, to, signal);
        this.failures = 0;
        return result;
      } catch (error) {
        if (error instanceof RoutingError && (error.code === 'no_route' || error.code === 'aborted')) throw error;
        this.failures += 1;
        if (this.failures >= this.threshold) {
          this.disabledUntil = this.now() + this.cooldown;
          this.failures = 0;
        }
        throw error;
      }
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }
}

export interface LegResult {
  coords: number[];
  /** true — построено по улицам; false — прямая линия. */
  routed: boolean;
  error?: RoutingError;
}

/** Строит участок по улицам, при любой ошибке возвращает прямую линию. */
export async function routeLegWithFallback(
  adapter: RoutingAdapter | null,
  from: LatLng,
  to: LatLng,
  signal?: AbortSignal,
): Promise<LegResult> {
  const straight = toFlat([from, to]);
  if (!adapter) return { coords: straight, routed: false };
  try {
    const coords = await adapter.route(from, to, signal);
    // гарантируем, что участок начинается и заканчивается в выбранных пользователем точках
    return { coords: [from.lat, from.lng, ...coords.slice(2, -2), to.lat, to.lng], routed: true };
  } catch (error) {
    const err = error instanceof RoutingError ? error : new RoutingError('unavailable', ROUTING_ERROR_TEXT.unavailable);
    return { coords: straight, routed: false, error: err };
  }
}

export const ROUTING_PRESETS = {
  'fossgis-foot': {
    label: 'OpenStreetMap (пешеходный, демо-сервис FOSSGIS)',
    baseUrl: 'https://routing.openstreetmap.de/routed-foot',
    profile: 'driving',
  },
} as const;

/** Создаёт адаптер по настройкам; null, если построение по улицам выключено или адрес неверный. */
export function createRoutingAdapter(settings: Settings, fetchImpl?: typeof fetch): RoutingAdapter | null {
  if (!settings.routingEnabled) return null;
  let baseUrl: string;
  let profile: string;
  let label: string;
  if (settings.routingPreset === 'custom') {
    const url = settings.routingCustomUrl.trim();
    if (!isHttpsUrl(url)) return null;
    baseUrl = url;
    profile = settings.routingCustomProfile.trim() || 'foot';
    label = 'Свой OSRM-сервер';
  } else {
    const preset = ROUTING_PRESETS['fossgis-foot'];
    baseUrl = preset.baseUrl;
    profile = preset.profile;
    label = preset.label;
  }
  return new GuardedRouting(new OsrmAdapter({ baseUrl, profile, fetchImpl, label, id: settings.routingPreset }));
}

export function isHttpsUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'));
  } catch {
    return false;
  }
}
