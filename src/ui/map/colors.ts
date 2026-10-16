import { useMemo } from 'react';
import { useApp } from '../AppContext';

export interface MapColors {
  brand: string;
  run: string;
  muted: string;
  accent: string;
}

function css(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * Карта рисуется на canvas, где CSS-переменные не работают, поэтому берём их реальные значения.
 * Пересчитывается при смене темы в настройках и системной темы.
 */
export function useMapColors(): MapColors {
  const { settings } = useApp();
  return useMemo(
    () => {
      void settings.theme;
      return {
        brand: css('--brand', '#0b7a57'),
        run: css('--run', '#bf3f0b'),
        muted: css('--muted', '#52625b'),
        accent: css('--accent', '#f5a524'),
      };
    },
    [settings.theme],
  );
}
