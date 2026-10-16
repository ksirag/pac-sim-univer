import { useCallback, useEffect, useRef, useState } from 'react';
import { buildActivity } from '../core/activity';
import {
  autoFinishIfDue, createSim, finish as finishSim, isTargetReached, pause as pauseSim, reconcile, resume as resumeSim, touch,
} from '../core/simulation';
import type { ActiveRecord, Activity, Settings, SimParams, SimState } from '../core/types';
import { describeStorageError, type Repo } from '../db/repo';

export interface Session {
  loaded: boolean;
  active: ActiveRecord | null;
  /** Сколько миллисекунд приложение было закрыто или свёрнуто (для пояснения пользователю). */
  awayMs: number | null;
  dismissAway: () => void;
  /** Последняя завершённая активность — для итоговой карточки. */
  lastFinished: Activity | null;
  dismissFinished: () => void;
  start: (params: SimParams, coords: number[]) => Promise<void>;
  pause: () => void;
  resume: () => void;
  /** save=false — завершить без записи в историю. */
  finish: (save: boolean) => Promise<void>;
}

const HEARTBEAT_MS = 5000;
const AWAY_NOTICE_MS = 20_000;

/**
 * Управляет текущей активностью. Состояние сохраняется в IndexedDB при каждом изменении
 * и периодически (метка «последний раз открыто»), поэтому его можно восстановить после
 * перезагрузки. Время считается по меткам, а не по тикам таймера.
 */
export function useSession(repo: Repo | null, settings: Settings, onError: (message: string) => void, onInfo: (message: string) => void): Session {
  const [active, setActive] = useState<ActiveRecord | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [awayMs, setAwayMs] = useState<number | null>(null);
  const [lastFinished, setLastFinished] = useState<Activity | null>(null);
  const ref = useRef<ActiveRecord | null>(null);
  const settingsRef = useRef(settings);
  const cbRef = useRef({ onError, onInfo });
  useEffect(() => {
    settingsRef.current = settings;
    cbRef.current = { onError, onInfo };
  });

  const commit = useCallback((record: ActiveRecord | null) => {
    ref.current = record;
    setActive(record);
  }, []);

  const persist = useCallback(
    async (record: ActiveRecord | null) => {
      if (!repo) return;
      try {
        if (record) await repo.saveActive(record);
        else await repo.clearActive();
      } catch (error) {
        cbRef.current.onError(describeStorageError(error));
      }
    },
    [repo],
  );

  const complete = useCallback(
    async (state: SimState, coords: number[], save: boolean) => {
      commit(null);
      if (!repo) return;
      try {
        if (save) {
          const activity = buildActivity(state, coords, settingsRef.current.weightKg);
          await repo.completeActivity(activity);
          setLastFinished(activity);
        } else {
          await repo.clearActive();
        }
      } catch (error) {
        cbRef.current.onError(describeStorageError(error));
      }
    },
    [repo, commit],
  );

  /** Приводит состояние в соответствие с часами: восстановление, автозавершение. */
  const reconcileNow = useCallback(
    async (initial: boolean) => {
      const rec = ref.current;
      if (!rec || rec.state.status === 'finished') return;
      const now = Date.now();
      const away = rec.state.status === 'running' ? now - rec.state.lastSeenAt : 0;
      const next = reconcile(rec.state, now, settingsRef.current.resumePolicy);
      if (away >= AWAY_NOTICE_MS || (initial && away > 0 && rec.state.status === 'running')) setAwayMs(away);
      if (next.status === 'finished') {
        cbRef.current.onInfo('Цель достигнута, пока приложение было закрыто. Активность сохранена в историю.');
        await complete(next, rec.coords, true);
        return;
      }
      if (next !== rec.state) {
        const updated = { ...rec, state: next, savedAt: now };
        commit(updated);
        await persist(updated);
      }
    },
    [commit, complete, persist],
  );

  // загрузка незавершённой активности при старте
  useEffect(() => {
    if (!repo) return;
    let cancelled = false;
    (async () => {
      try {
        const record = await repo.getActive();
        if (cancelled) return;
        if (record) {
          ref.current = record;
          setActive(record);
          await reconcileNow(true);
        }
      } catch (error) {
        cbRef.current.onError(describeStorageError(error));
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo, reconcileNow]);

  // возвращение в приложение, уход в фон, закрытие
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reconcileNow(false);
      else {
        const rec = ref.current;
        if (rec && rec.state.status === 'running') {
          const updated = { ...rec, state: touch(rec.state, Date.now()), savedAt: Date.now() };
          commit(updated);
          void persist(updated);
        }
      }
    };
    const onPageHide = () => {
      const rec = ref.current;
      if (rec && rec.state.status === 'running') void persist({ ...rec, state: touch(rec.state, Date.now()), savedAt: Date.now() });
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onVisible);
    };
  }, [commit, persist, reconcileNow]);

  // сердцебиение: обновляем «последний раз открыто» и ловим достижение цели
  const running = active?.state.status === 'running';
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      const rec = ref.current;
      if (!rec || rec.state.status !== 'running') return;
      const now = Date.now();
      if (isTargetReached(rec.state, now)) {
        const done = autoFinishIfDue(rec.state, now);
        cbRef.current.onInfo('Цель достигнута — активность сохранена в историю.');
        void complete(done, rec.coords, true);
        return;
      }
      const updated = { ...rec, state: touch(rec.state, now), savedAt: now };
      commit(updated);
      void persist(updated);
    }, HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [running, commit, complete, persist]);

  const start = useCallback(
    async (params: SimParams, coords: number[]) => {
      const now = Date.now();
      const record: ActiveRecord = { id: 'current', state: createSim(params, now), coords, savedAt: now };
      setLastFinished(null);
      setAwayMs(null);
      commit(record);
      await persist(record);
    },
    [commit, persist],
  );

  const mutate = useCallback(
    (fn: (s: SimState, now: number) => SimState) => {
      const rec = ref.current;
      if (!rec) return;
      const now = Date.now();
      const next = fn(rec.state, now);
      if (next === rec.state) return;
      const updated = { ...rec, state: next, savedAt: now };
      commit(updated);
      void persist(updated);
    },
    [commit, persist],
  );

  const pause = useCallback(() => mutate(pauseSim), [mutate]);
  const resume = useCallback(() => mutate(resumeSim), [mutate]);

  const finish = useCallback(
    async (save: boolean) => {
      const rec = ref.current;
      if (!rec) return;
      const done = finishSim(rec.state, Date.now());
      await complete(done, rec.coords, save);
    },
    [complete],
  );

  return {
    loaded,
    active,
    awayMs,
    dismissAway: () => setAwayMs(null),
    lastFinished,
    dismissFinished: () => setLastFinished(null),
    start,
    pause,
    resume,
    finish,
  };
}
