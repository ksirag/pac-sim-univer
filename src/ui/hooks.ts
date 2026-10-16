import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

/** Текущее время для ОТОБРАЖЕНИЯ. Расчёты опираются на метки времени, а не на тики этого хука. */
export function useNow(active: boolean, intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    const onVisible = () => setNow(Date.now());
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
    };
  }, [active, intervalMs]);
  return now;
}

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

/** Установлено ли приложение на экран «Домой» (режим standalone). */
export function isStandalone(): boolean {
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

export function isIOS(): boolean {
  const ua = window.navigator.userAgent;
  const iPadOS = ua.includes('Mac') && 'ontouchend' in document;
  return /iPhone|iPad|iPod/.test(ua) || iPadOS;
}

/** Блокировка прокрутки страницы под шторкой/диалогом. */
export function useBodyLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}

/** Возвращает фокус на элемент, который был активен до открытия шторки. */
export function useRestoreFocus(active: boolean) {
  const prev = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!active) return;
    prev.current = document.activeElement as HTMLElement | null;
    return () => prev.current?.focus?.();
  }, [active]);
}
