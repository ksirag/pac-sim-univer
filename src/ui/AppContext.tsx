import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createRoutingAdapter, type RoutingAdapter } from '../core/routing';
import { DEFAULT_SETTINGS, type Settings } from '../core/types';
import { describeStorageError, type Repo } from '../db/repo';
import { useOnline } from './hooks';
import { OSM_TILES } from './map/LeafletMap';
import { useSession, type Session } from './session';
import type { PlanForm } from '../core/planForm';
import { useToast } from './toast';

export interface AppValue {
  repo: Repo;
  memoryMode: boolean;
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => Promise<boolean>;
  routing: RoutingAdapter | null;
  tileUrl: string;
  session: Session;
  online: boolean;
  /** Черновик формы активности: сохраняется при переключении вкладок (только в памяти). */
  draft: PlanForm | null;
  setDraft: (form: PlanForm | null) => void;
  /** Выбранный на экране «Активность» маршрут (id) или null. */
  draftRouteId: string | null;
  setDraftRouteId: (id: string | null) => void;
}

const AppContext = createContext<AppValue | null>(null);

export function useApp(): AppValue {
  const v = useContext(AppContext);
  if (!v) throw new Error('AppProvider отсутствует');
  return v;
}

export function isValidTileTemplate(url: string): boolean {
  try {
    const u = new URL(url.replace('{z}', '1').replace('{x}', '1').replace('{y}', '1'));
    return u.protocol === 'https:' && url.includes('{z}') && url.includes('{x}') && url.includes('{y}');
  } catch {
    return false;
  }
}

export function AppProvider({ repo, memoryMode, initialSettings, children }: { repo: Repo; memoryMode: boolean; initialSettings: Settings; children: ReactNode }) {
  const toast = useToast();
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [draft, setDraft] = useState<PlanForm | null>(null);
  const [draftRouteId, setDraftRouteId] = useState<string | null>(null);
  const online = useOnline();

  const onError = useCallback((message: string) => toast.show(message, { kind: 'error' }), [toast]);
  const onInfo = useCallback((message: string) => toast.show(message), [toast]);
  const session = useSession(repo, settings, onError, onInfo);

  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  });

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      try {
        const saved = await repo.saveSettings({ ...settingsRef.current, ...patch });
        setSettings(saved);
        return true;
      } catch (error) {
        toast.show(describeStorageError(error), { kind: 'error' });
        return false;
      }
    },
    [repo, toast],
  );

  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'auto') root.removeAttribute('data-theme');
    else root.dataset.theme = settings.theme;
  }, [settings.theme]);

  // просим браузер не вытеснять данные приложения (где поддерживается)
  useEffect(() => {
    void navigator.storage?.persist?.().catch(() => undefined);
  }, []);

  const routing = useMemo(
    () => createRoutingAdapter(settings),
    // адаптер пересоздаётся только при смене связанных настроек
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.routingEnabled, settings.routingPreset, settings.routingCustomUrl, settings.routingCustomProfile],
  );
  const tileUrl = settings.tilesPreset === 'custom' && isValidTileTemplate(settings.tilesCustomUrl) ? settings.tilesCustomUrl : OSM_TILES;

  const value = useMemo<AppValue>(
    () => ({ repo, memoryMode, settings, updateSettings, routing, tileUrl, session, online, draft, setDraft, draftRouteId, setDraftRouteId }),
    [repo, memoryMode, settings, updateSettings, routing, tileUrl, session, online, draft, draftRouteId],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export { DEFAULT_SETTINGS };
