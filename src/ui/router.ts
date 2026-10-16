import { useSyncExternalStore } from 'react';

/** Мини-роутер на hash: работает без серверных правил перенаправления и поддерживает жест «назад» в Safari. */
function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}
const getSnapshot = () => window.location.hash || '#/activity';

export interface Route {
  path: string;
  segments: string[];
  query: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/activity';
  const [pathPart = '', queryPart = ''] = raw.split('?');
  const path = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;
  return { path, segments: path.split('/').filter(Boolean), query: new URLSearchParams(queryPart) };
}

export function useHashRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getSnapshot, () => '#/activity');
  return parseHash(hash);
}

export function navigate(path: string, options: { replace?: boolean } = {}) {
  const target = `#${path}`;
  if (options.replace) window.location.replace(target);
  else window.location.hash = target;
}
