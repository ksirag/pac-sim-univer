import { useMemo } from 'react';
import { flatBounds, fromFlat, reduceToMaxPoints } from '../core/geo';

/** Миниатюра формы маршрута (без карты и без сети). */
export function RouteThumb({ coords, size = 56, tone = 'brand' }: { coords: readonly number[]; size?: number; tone?: 'brand' | 'run' }) {
  const d = useMemo(() => {
    const b = flatBounds(coords);
    if (!b) return '';
    const pts = fromFlat(reduceToMaxPoints(coords, 80));
    const kx = Math.cos((((b.north + b.south) / 2) * Math.PI) / 180);
    const w = Math.max((b.east - b.west) * kx, 1e-9);
    const h = Math.max(b.north - b.south, 1e-9);
    const scale = (size - 12) / Math.max(w, h);
    const ox = (size - w * scale) / 2;
    const oy = (size - h * scale) / 2;
    return pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${(ox + (p.lng - b.west) * kx * scale).toFixed(1)} ${(oy + (b.north - p.lat) * scale).toFixed(1)}`)
      .join(' ');
  }, [coords, size]);
  return (
    <svg className="thumb" viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
      <rect width={size} height={size} rx="12" className="thumb-bg" />
      <path d={d} className={`thumb-line ${tone}`} />
    </svg>
  );
}
