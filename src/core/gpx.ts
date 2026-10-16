import { gpx as gpxToGeoJson } from '@tmcw/togeojson';
import type { Feature, Geometry } from 'geojson';
import { dedupeConsecutive, flatCount, flatLength, isValidLatLng } from './geo';
import type { Route } from './types';

export const MAX_GPX_BYTES = 25 * 1024 * 1024;

export interface ParsedTrack {
  name: string;
  /** Плоский массив [lat, lng, …] */
  coords: number[];
  distanceM: number;
  pointCount: number;
}

export type GpxResult =
  | { ok: true; tracks: ParsedTrack[]; warnings: string[] }
  | { ok: false; error: string };

type Position = number[];

function collectLines(geometry: Geometry | null): Position[][] {
  if (!geometry) return [];
  if (geometry.type === 'LineString') return [geometry.coordinates];
  if (geometry.type === 'MultiLineString') return geometry.coordinates;
  if (geometry.type === 'GeometryCollection') return geometry.geometries.flatMap((g) => collectLines(g));
  return [];
}

/**
 * Разбирает GPX (треки и маршруты). Путевые точки (waypoints) игнорируются.
 * Внимание к порядку координат: GeoJSON хранит [долгота, широта], а приложение — (широта, долгота);
 * преобразование происходит здесь.
 */
export function parseGpx(text: string): GpxResult {
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, error: 'Файл пустой.' };
  if (text.length > MAX_GPX_BYTES) return { ok: false, error: 'Файл слишком большой (максимум 25 МБ).' };

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(text, 'application/xml');
  } catch {
    return { ok: false, error: 'Не удалось прочитать файл как XML.' };
  }
  if (doc.getElementsByTagName('parsererror').length > 0) {
    return { ok: false, error: 'Файл повреждён: это не корректный XML.' };
  }
  const root = doc.documentElement;
  if (!root || root.localName.toLowerCase() !== 'gpx') {
    return { ok: false, error: 'Это не GPX-файл: не найден корневой элемент <gpx>.' };
  }

  let features: Feature[];
  try {
    features = gpxToGeoJson(doc).features;
  } catch {
    return { ok: false, error: 'Не удалось разобрать содержимое GPX.' };
  }

  const warnings: string[] = [];
  const tracks: ParsedTrack[] = [];
  let dropped = 0;
  let index = 0;
  for (const feature of features) {
    const lines = collectLines(feature.geometry);
    if (lines.length === 0) continue;
    index += 1;
    const flat: number[] = [];
    for (const line of lines) {
      for (const pos of line) {
        const lng = Number(pos[0]);
        const lat = Number(pos[1]);
        if (!isValidLatLng(lat, lng)) {
          dropped += 1;
          continue;
        }
        flat.push(lat, lng);
      }
    }
    const coords = dedupeConsecutive(flat);
    if (flatCount(coords) < 2) continue;
    const rawName = feature.properties && typeof feature.properties.name === 'string' ? feature.properties.name.trim() : '';
    tracks.push({
      name: rawName || `Трек ${index}`,
      coords,
      distanceM: flatLength(coords),
      pointCount: flatCount(coords),
    });
  }

  if (dropped > 0) warnings.push(`Пропущено точек с некорректными координатами: ${dropped}.`);
  if (tracks.length === 0) {
    return {
      ok: false,
      error: 'В файле нет трека с двумя и более точками. Возможно, там только путевые точки или пустой трек.',
    };
  }
  const zero = tracks.filter((t) => t.distanceM < 1);
  if (zero.length === tracks.length) return { ok: false, error: 'Трек имеет нулевую длину: все точки совпадают.' };
  if (tracks.length > 1) warnings.push(`В файле несколько треков (${tracks.length}) — выберите нужный.`);
  return { ok: true, tracks, warnings };
}

const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Экспорт маршрута в GPX 1.1 (один трек, один сегмент). Времени у точек нет: это не запись движения. */
export function exportGpx(route: Pick<Route, 'name' | 'coords'>, created: Date = new Date()): string {
  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Pacer Simulator" xmlns="http://www.topografix.com/GPX/1/1">',
    `<metadata><name>${xmlEscape(route.name)}</name><time>${created.toISOString()}</time></metadata>`,
    `<trk><name>${xmlEscape(route.name)}</name><trkseg>`,
  ];
  for (let i = 0; i + 1 < route.coords.length; i += 2) {
    parts.push(`<trkpt lat="${route.coords[i]!.toFixed(7)}" lon="${route.coords[i + 1]!.toFixed(7)}"/>`);
  }
  parts.push('</trkseg></trk>', '</gpx>');
  return parts.join('\n');
}

/** Имя файла для скачивания: без недопустимых символов. */
export function gpxFileName(name: string): string {
  const forbidden = '\\/:*?"<>|';
  const cleaned = [...name].filter((ch) => ch.charCodeAt(0) >= 32 && !forbidden.includes(ch)).join('');
  const base = cleaned.replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${base || 'маршрут'}.gpx`;
}
