import L from 'leaflet';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flatBounds, fromFlat } from '../../core/geo';
import { Icon } from '../Icon';
import { useOnline } from '../hooks';

const MapContext = createContext<L.Map | null>(null);
export const useMap = () => useContext(MapContext);

export const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const DEFAULT_CENTER: L.LatLngTuple = [55.751, 37.618];

/** Строка атрибуции: обязательна по условиям лицензии ODbL / политики тайл-сервера OSM. */
function attributionFor(tileUrl: string): string {
  if (tileUrl === OSM_TILES) {
    return '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';
  }
  return 'Карта: пользовательский источник · данные © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors (если применимо)';
}

export interface LeafletMapProps {
  tileUrl: string;
  className?: string;
  interactive?: boolean;
  children?: ReactNode;
  /** Подпись для экранных дикторов. */
  label: string;
  onReady?: (map: L.Map) => void;
}

/**
 * Обёртка над Leaflet. Если плитки карты не загружаются (нет сети, сервис недоступен),
 * показывается понятное сообщение — расчёты и маршруты при этом продолжают работать.
 */
export function LeafletMap({ tileUrl, className, interactive = true, children, label, onReady }: LeafletMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<L.Map | null>(null);
  const [tileFailed, setTileFailed] = useState(false);
  const failures = useRef(0);
  const online = useOnline();
  const readyRef = useRef(onReady);
  useEffect(() => {
    readyRef.current = onReady;
  });

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, {
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
      zoomSnap: 0.5,
      dragging: interactive,
      touchZoom: interactive,
      scrollWheelZoom: interactive,
      doubleClickZoom: interactive,
      boxZoom: false,
      keyboard: interactive,
      tap: false,
    } as L.MapOptions);
    m.attributionControl.setPrefix(false);
    m.setView(DEFAULT_CENTER, 12);
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    setMap(m);
    readyRef.current?.(m);
    return () => {
      ro.disconnect();
      m.remove();
      setMap(null);
    };
  }, [interactive]);

  useEffect(() => {
    if (!map) return;
    const layer = L.tileLayer(tileUrl, { maxZoom: 19, attribution: attributionFor(tileUrl), crossOrigin: true });
    const onError = () => {
      failures.current += 1;
      if (failures.current >= 3) setTileFailed(true);
    };
    const onLoad = () => {
      failures.current = 0;
      setTileFailed(false);
    };
    layer.on('tileerror', onError);
    layer.on('tileload', onLoad);
    layer.addTo(map);
    return () => {
      layer.off('tileerror', onError);
      layer.off('tileload', onLoad);
      layer.remove();
    };
  }, [map, tileUrl]);

  const problem = !online ? 'offline' : tileFailed ? 'failed' : null;

  return (
    <div className={`map-wrap ${className ?? ''}`}>
      <div ref={el} className="map" role="application" aria-label={label} />
      {map ? <MapContext.Provider value={map}>{children}</MapContext.Provider> : null}
      {problem ? (
        <div className="map-notice" role="status">
          <Icon name={problem === 'offline' ? 'wifiOff' : 'alert'} size={18} />
          <span>
            {problem === 'offline'
              ? 'Нет сети: карта не загружается. Маршрут и расчёты работают.'
              : 'Не удалось загрузить карту. Проверьте интернет — маршрут и расчёты работают.'}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function useLatLngs(flat: readonly number[]) {
  return useMemo(() => fromFlat(flat).map((p) => L.latLng(p.lat, p.lng)), [flat]);
}

export function PolylineLayer({
  coords, color, weight = 5, opacity = 1, dashArray, interactive = false, onClick,
}: {
  coords: readonly number[];
  color: string;
  weight?: number;
  opacity?: number;
  dashArray?: string;
  interactive?: boolean;
  onClick?: (e: L.LeafletMouseEvent) => void;
}) {
  const map = useMap();
  const latlngs = useLatLngs(coords);
  const line = useRef<L.Polyline | null>(null);
  const clickRef = useRef(onClick);
  useEffect(() => {
    clickRef.current = onClick;
  });

  useEffect(() => {
    if (!map) return;
    const pl = L.polyline([], { color, weight, opacity, dashArray, lineCap: 'round', lineJoin: 'round', smoothFactor: 1.5, interactive });
    pl.on('click', (e) => clickRef.current?.(e as L.LeafletMouseEvent));
    pl.addTo(map);
    line.current = pl;
    return () => {
      pl.remove();
      line.current = null;
    };
  }, [map, color, weight, opacity, dashArray, interactive]);

  useEffect(() => {
    line.current?.setLatLngs(latlngs);
  }, [latlngs, map, color, weight, opacity, dashArray, interactive]);
  return null;
}

/** Подгоняет карту под геометрию. Срабатывает при смене `fitKey` (например, id маршрута). */
export function FitBounds({ coords, fitKey, padding = 36 }: { coords: readonly number[]; fitKey: string; padding?: number }) {
  const map = useMap();
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!map || done.current === fitKey) return;
    const b = flatBounds(coords);
    if (!b) return;
    done.current = fitKey;
    if (b.south === b.north && b.west === b.east) map.setView([b.south, b.west], 16);
    else map.fitBounds([[b.south, b.west], [b.north, b.east]], { padding: [padding, padding], animate: false, maxZoom: 18 });
  }, [map, coords, fitKey, padding]);
  return null;
}

const iconCache = new Map<string, L.DivIcon>();
export function pinIcon(kind: 'start' | 'end' | 'point' | 'pos' | 'selected', text = ''): L.DivIcon {
  const key = `${kind}:${text}`;
  let icon = iconCache.get(key);
  if (!icon) {
    const size = kind === 'point' || kind === 'selected' ? 28 : kind === 'pos' ? 26 : 34;
    icon = L.divIcon({
      className: '',
      html: `<div class="pin pin-${kind}"><span>${text}</span></div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
    iconCache.set(key, icon);
  }
  return icon;
}

export function PinLayer({ lat, lng, kind, text }: { lat: number; lng: number; kind: 'start' | 'end' | 'pos'; text?: string }) {
  const map = useMap();
  const marker = useRef<L.Marker | null>(null);
  useEffect(() => {
    if (!map) return;
    const m = L.marker([lat, lng], { icon: pinIcon(kind, text), interactive: false, keyboard: false, zIndexOffset: kind === 'pos' ? 1000 : 500 });
    m.addTo(map);
    marker.current = m;
    return () => {
      m.remove();
      marker.current = null;
    };
  }, [map, kind, text]); // eslint-disable-line react-hooks/exhaustive-deps -- позиция обновляется ниже без пересоздания маркера

  useEffect(() => {
    marker.current?.setLatLng([lat, lng]);
  }, [lat, lng, map, kind, text]);
  return null;
}

/** Маркеры начала и конца маршрута. */
export function StartEndMarkers({ coords }: { coords: readonly number[] }) {
  if (coords.length < 4) return null;
  const n = coords.length;
  return (
    <>
      <PinLayer lat={coords[0]!} lng={coords[1]!} kind="start" text="С" />
      <PinLayer lat={coords[n - 2]!} lng={coords[n - 1]!} kind="end" text="Ф" />
    </>
  );
}

/** Кнопки масштаба и «моё местоположение» (геолокация запрашивается только по нажатию). */
export function MapControls({ onLocate, locating }: { onLocate?: () => void; locating?: boolean }) {
  const map = useMap();
  return (
    <div className="map-controls">
      <button type="button" className="icon-btn filled" aria-label="Приблизить" onClick={() => map?.zoomIn()}>
        <Icon name="plus" />
      </button>
      <button type="button" className="icon-btn filled" aria-label="Отдалить" onClick={() => map?.zoomOut()}>
        <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>
      </button>
      {onLocate ? (
        <button type="button" className="icon-btn filled" aria-label="Показать моё местоположение" onClick={onLocate} disabled={locating}>
          {locating ? <span className="spinner" aria-hidden /> : <Icon name="locate" />}
        </button>
      ) : null}
    </div>
  );
}
