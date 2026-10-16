import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { DEFAULT_SETTINGS, type Settings } from './core/types';
import { PacerDB } from './db/db';
import { createMemoryRepo } from './db/memory';
import { describeStorageError, Repo } from './db/repo';
import { ActivityDetailScreen } from './screens/ActivityDetailScreen';
import { ActivityScreen } from './screens/ActivityScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { RouteEditorScreen } from './screens/RouteEditorScreen';
import { RoutesScreen } from './screens/RoutesScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { AppProvider, useApp } from './ui/AppContext';
import { BottomNav } from './ui/BottomNav';
import { isIOS, isStandalone } from './ui/hooks';
import { Icon } from './ui/Icon';
import { Banner } from './ui/parts';
import { useHashRoute } from './ui/router';
import { ToastProvider } from './ui/toast';

type Boot =
  | { status: 'loading' }
  | { status: 'ready'; repo: Repo; settings: Settings; memoryMode: boolean }
  | { status: 'error'; message: string };

async function openRepo(): Promise<Boot> {
  const repo = new Repo(new PacerDB());
  try {
    await repo.init();
    return { status: 'ready', repo, settings: await repo.getSettings(), memoryMode: false };
  } catch (error) {
    return { status: 'error', message: describeStorageError(error) };
  }
}

export function App() {
  const [boot, setBoot] = useState<Boot>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    openRepo().then((b) => { if (!cancelled) setBoot(b); });
    return () => { cancelled = true; };
  }, []);

  async function continueWithoutStorage() {
    const repo = await createMemoryRepo();
    await repo.init();
    setBoot({ status: 'ready', repo, settings: DEFAULT_SETTINGS, memoryMode: true });
  }

  if (boot.status === 'loading') {
    return <div className="boot" aria-busy="true"><span className="spinner" aria-label="Загрузка" /></div>;
  }
  if (boot.status === 'error') {
    return (
      <div className="boot boot-error">
        <Icon name="alert" size={40} />
        <h1>Не удалось открыть хранилище</h1>
        <p className="muted">{boot.message}</p>
        <button type="button" className="btn btn-primary btn-lg" onClick={() => window.location.reload()}>Повторить</button>
        <button type="button" className="btn btn-outline btn-lg" onClick={() => void continueWithoutStorage()}>Продолжить без сохранения</button>
        <p className="muted small">Без хранилища всё работает, но маршруты и история пропадут после закрытия приложения.</p>
      </div>
    );
  }
  return (
    <ToastShell>
      <AppProvider repo={boot.repo} memoryMode={boot.memoryMode} initialSettings={boot.settings}>
        <Shell />
      </AppProvider>
    </ToastShell>
  );
}

function ToastShell({ children }: { children: React.ReactNode }) {
  const route = useHashRoute();
  const withNav = !isFullscreen(route.segments);
  return <ToastProvider withNav={withNav}>{children}</ToastProvider>;
}

/** Экраны без нижней навигации: редактору нужна вся высота. */
function isFullscreen(segments: string[]): boolean {
  return segments[0] === 'routes' && segments.length >= 2;
}

function Shell() {
  const route = useHashRoute();
  const { session, online, memoryMode } = useApp();
  const [installDismissed, setInstallDismissed] = useState(() => {
    try { return localStorage.getItem('install-hint') === '1'; } catch { return false; }
  });
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW();
  const [tab] = route.segments;
  const fullscreen = isFullscreen(route.segments);
  const current = ['activity', 'routes', 'history', 'settings'].includes(tab ?? '') ? tab! : 'activity';

  let screen: React.ReactNode;
  if (tab === 'routes' && route.segments[1] === 'new') screen = <RouteEditorScreen key="new" routeId={null} />;
  else if (tab === 'routes' && route.segments[2] === 'edit' && route.segments[1]) screen = <RouteEditorScreen key={route.segments[1]} routeId={route.segments[1]} />;
  else if (tab === 'routes') screen = <RoutesScreen />;
  else if (tab === 'history' && route.segments[1]) screen = <ActivityDetailScreen id={route.segments[1]} />;
  else if (tab === 'history') screen = <HistoryScreen />;
  else if (tab === 'settings') screen = <SettingsScreen />;
  else screen = <ActivityScreen />;

  const showInstall = isIOS() && !isStandalone() && !installDismissed && current === 'activity' && !session.active;

  return (
    <div className={`app${fullscreen ? ' app-full' : ''}`}>
      <div className="app-banners">
        {!online ? (
          <Banner kind="warn" icon="wifiOff">Нет сети. Приложение работает, но карта и построение по улицам недоступны.</Banner>
        ) : null}
        {memoryMode ? <Banner kind="warn" icon="alert">Данные не сохраняются: хранилище недоступно.</Banner> : null}
        {needRefresh ? (
          <Banner icon="info">
            Доступна новая версия.{' '}
            <button type="button" className="link-btn" onClick={() => void updateServiceWorker(true)} disabled={!!session.active && session.active.state.status === 'running'}>Обновить</button>{' '}
            <button type="button" className="link-btn" onClick={() => setNeedRefresh(false)}>Позже</button>
            {session.active ? <span className="muted small"> Завершите активность перед обновлением.</span> : null}
          </Banner>
        ) : null}
        {showInstall ? (
          <Banner icon="home">
            Чтобы открывать как приложение: Safari → «Поделиться» → «На экран “Домой”».{' '}
            <button type="button" className="link-btn" onClick={() => { setInstallDismissed(true); try { localStorage.setItem('install-hint', '1'); } catch { /* недоступно */ } }}>Скрыть</button>
          </Banner>
        ) : null}
      </div>
      <main className="app-main" id="main">{screen}</main>
      {!fullscreen ? <BottomNav current={current} live={!!session.active} /> : null}
    </div>
  );
}
