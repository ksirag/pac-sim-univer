import type L from 'leaflet';
import { useCallback, useEffect, useRef, useState } from 'react';
import { exportGpx, gpxFileName } from '../core/gpx';
import { formatDateShort, formatDistance } from '../core/format';
import { flatCount, flatLength, joinFlat, reduceToMaxPoints } from '../core/geo';
import { ROUTING_ERROR_TEXT, routeLegWithFallback, type RoutingError } from '../core/routing';
import {
  addPoint, buildGeometry, closePath, finishFreehand, insertPoint, makeEditable, movePoint, newId, pathFromRoute,
  removePoint, reversePath, routeFromGeometry, routeFromPath, type EditablePath,
} from '../core/routeModel';
import type { LatLng, Route } from '../core/types';
import { describeStorageError } from '../db/repo';
import { useApp } from '../ui/AppContext';
import { EditorLayer, type Tool } from '../ui/editor/EditorLayer';
import { EMPTY_EDITOR, editorGeometry, useEditor, type EditorState } from '../ui/editor/useEditor';
import { saveTextFile } from '../ui/files';
import { Icon } from '../ui/Icon';
import { FitBounds, LeafletMap, MapControls, useMap } from '../ui/map/LeafletMap';
import { NameSheet } from '../ui/NameSheet';
import { Banner, Segmented } from '../ui/parts';
import { navigate } from '../ui/router';
import { ConfirmDialog, Sheet } from '../ui/Sheet';
import { useToast } from '../ui/toast';

const MIN_ROUTE_M = 5;

function stateFromRoute(route: Route): EditorState {
  const path = pathFromRoute(route);
  return path ? { kind: 'path', path, raw: [] } : { kind: 'raw', path: { control: [], legs: [] }, raw: route.coords };
}

function sameLatLng(a: LatLng | undefined, b: LatLng) {
  return !!a && a.lat === b.lat && a.lng === b.lng;
}

function withLeg(s: EditorState, index: number, from: LatLng, to: LatLng, coords: number[]): EditorState {
  if (s.kind !== 'path' || !sameLatLng(s.path.control[index], from) || !sameLatLng(s.path.control[index + 1], to)) return s;
  const legs = s.path.legs.map((l, i) => (i === index ? coords : l));
  return { ...s, path: { ...s.path, legs } };
}

export function RouteEditorScreen({ routeId }: { routeId: string | null }) {
  const { repo, settings, routing, tileUrl } = useApp();
  const toast = useToast();
  const ed = useEditor();
  const { reset } = ed;
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'missing' | 'error'>(routeId ? 'loading' : 'ready');
  const [original, setOriginal] = useState<Route | null>(null);
  const [tool, setTool] = useState<Tool>('points');
  const [selected, setSelected] = useState<number | null>(null);
  const [streets, setStreets] = useState(settings.routingEnabled);
  const [pending, setPending] = useState(0);
  const [menu, setMenu] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | 'leave' | 'clear'>(null);
  const [locating, setLocating] = useState(false);
  const [mapRef, setMapRef] = useState<L.Map | null>(null);
  const lastFailToast = useRef(0);
  const drawHinted = useRef(false);

  // загрузка существующего маршрута
  useEffect(() => {
    if (!routeId) return;
    let cancelled = false;
    repo
      .getRoute(routeId)
      .then((route) => {
        if (cancelled) return;
        if (!route) {
          setLoadState('missing');
          return;
        }
        setOriginal(route);
        reset(stateFromRoute(route));
        setLoadState('ready');
      })
      .catch(() => !cancelled && setLoadState('error'));
    return () => {
      cancelled = true;
    };
  }, [repo, routeId, reset]);

  const state = ed.state;
  const geometry = editorGeometry(state);
  const distance = flatLength(geometry);
  const count = flatCount(geometry);
  const controlCount = state.kind === 'path' ? state.path.control.length : 0;
  const streetsAvailable = !!routing;
  const useStreets = streets && streetsAvailable;
  const dirty = ed.changed;

  const notifyFail = useCallback(
    (error?: RoutingError) => {
      const now = Date.now();
      if (now - lastFailToast.current < 15_000) return;
      lastFailToast.current = now;
      const why = error ? ROUTING_ERROR_TEXT[error.code] : ROUTING_ERROR_TEXT.unavailable;
      toast.show(`${why}. Участок проведён прямой линией — маршрут можно продолжать.`);
    },
    [toast],
  );

  /** Строит участок по улицам и подставляет его, если точки с тех пор не менялись. */
  const requestLeg = useCallback(
    (index: number, from: LatLng, to: LatLng) => {
      if (!routing || !streets) return;
      setPending((n) => n + 1);
      routeLegWithFallback(routing, from, to)
        .then((res) => {
          if (res.routed) ed.patch((s) => withLeg(s, index, from, to, res.coords));
          else if (res.error && res.error.code !== 'aborted') notifyFail(res.error);
        })
        .finally(() => setPending((n) => n - 1));
    },
    [routing, streets, ed, notifyFail],
  );

  const rerouteAround = useCallback(
    (path: EditablePath, legs: number[]) => {
      for (const i of legs) {
        const a = path.control[i];
        const b = path.control[i + 1];
        if (a && b) requestLeg(i, a, b);
      }
    },
    [requestLeg],
  );

  const onAdd = useCallback(
    (p: LatLng) => {
      const base = state.kind === 'path' ? state.path : { control: [], legs: [] };
      const next = addPoint(base, p, null);
      ed.commit({ kind: 'path', path: next, raw: [] });
      setSelected(null);
      if (next.control.length >= 2) rerouteAround(next, [next.control.length - 2]);
    },
    [state, ed, rerouteAround],
  );

  const onMove = useCallback(
    (index: number, p: LatLng) => {
      if (state.kind !== 'path') return;
      const next = movePoint(state.path, index, p);
      ed.commit({ kind: 'path', path: next, raw: [] });
      rerouteAround(next, [index - 1, index]);
    },
    [state, ed, rerouteAround],
  );

  const onInsert = useCallback(
    (leg: number, p: LatLng) => {
      if (state.kind !== 'path' || leg < 0) return;
      const next = insertPoint(state.path, leg, p);
      ed.commit({ kind: 'path', path: next, raw: [] });
      setSelected(null);
      rerouteAround(next, [leg, leg + 1]);
    },
    [state, ed, rerouteAround],
  );

  const deleteSelected = () => {
    if (state.kind !== 'path' || selected === null) return;
    const next = removePoint(state.path, selected);
    ed.commit({ kind: 'path', path: next, raw: [] });
    setSelected(null);
    if (selected > 0 && selected < state.path.control.length - 1) rerouteAround(next, [selected - 1]);
  };

  const onStroke = useCallback(
    (flat: number[]) => {
      const stroke = finishFreehand(flat);
      const existing = editorGeometry(state);
      if (state.kind === 'path' && state.path.control.length >= 2 && !drawHinted.current) {
        drawHinted.current = true;
        toast.show('Рисование превращает маршрут в свободную линию. Отменить можно кнопкой «Отменить».');
      }
      const raw = existing.length >= 2 ? joinFlat([existing, [existing[existing.length - 2]!, existing[existing.length - 1]!], stroke]) : stroke;
      ed.commit({ kind: 'raw', path: { control: [], legs: [] }, raw });
      setSelected(null);
    },
    [state, ed, toast],
  );

  const convertRaw = () => {
    if (state.kind !== 'raw') return;
    const path = makeEditable(state.raw);
    ed.commit({ kind: 'path', path, raw: [] });
    setSelected(null);
    toast.show(`Маршрут упрощён до ${path.control.length} опорных точек — теперь их можно двигать.`);
  };

  const reverse = () => {
    if (state.kind === 'path') ed.commit({ ...state, path: reversePath(state.path) });
    else {
      const flat: number[] = [];
      for (let i = flatCount(state.raw) - 1; i >= 0; i--) flat.push(state.raw[i * 2]!, state.raw[i * 2 + 1]!);
      ed.commit({ ...state, raw: flat });
    }
    setSelected(null);
    setMenu(false);
  };

  const closeLoop = () => {
    if (state.kind !== 'path') return;
    const next = closePath(state.path);
    if (next === state.path) {
      toast.show('Чтобы замкнуть маршрут, нужно минимум три точки.');
    } else {
      ed.commit({ kind: 'path', path: next, raw: [] });
      rerouteAround(next, [next.control.length - 2]);
    }
    setMenu(false);
  };

  const simplifyRaw = () => {
    if (state.kind !== 'raw') return;
    const raw = reduceToMaxPoints(state.raw, Math.max(50, Math.floor(flatCount(state.raw) / 2)));
    ed.commit({ ...state, raw });
    toast.show(`Точек стало меньше: ${flatCount(raw).toLocaleString('ru-RU')}.`);
    setMenu(false);
  };

  const exportCurrent = async () => {
    setMenu(false);
    if (count < 2) {
      toast.show('Сначала постройте маршрут.');
      return;
    }
    try {
      const name = original?.name ?? 'Маршрут';
      const result = await saveTextFile(gpxFileName(name), exportGpx({ name, coords: geometry }), 'application/gpx+xml');
      if (result === 'downloaded') toast.show('Файл GPX скачан.');
    } catch {
      toast.show('Не удалось сохранить файл GPX.', { kind: 'error' });
    }
  };

  const locate = () => {
    if (!navigator.geolocation) {
      toast.show('Определение местоположения недоступно в этом браузере.', { kind: 'error' });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        mapRef?.setView([pos.coords.latitude, pos.coords.longitude], 16);
      },
      (err) => {
        setLocating(false);
        toast.show(
          err.code === err.PERMISSION_DENIED
            ? 'Доступ к местоположению запрещён. Разрешите его в настройках Safari или найдите нужное место на карте вручную.'
            : 'Не удалось определить местоположение. Найдите нужное место на карте вручную.',
          { kind: 'error' },
        );
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  const openSave = () => {
    if (count < 2 || distance < MIN_ROUTE_M) {
      toast.show('Добавьте минимум две точки, чтобы получился маршрут.', { kind: 'error' });
      return;
    }
    setSaveName(original?.name ?? `Маршрут ${formatDateShort(Date.now())}`);
    setSaving(true);
  };

  const save = async (name: string, thenSimulate: boolean) => {
    setBusy(true);
    const now = Date.now();
    const draft = {
      id: original?.id ?? newId(),
      name,
      source: original?.source ?? ('drawn' as const),
      createdAt: original?.createdAt ?? now,
      updatedAt: now,
    };
    const route = state.kind === 'path' ? routeFromPath(draft, state.path) : routeFromGeometry(draft, state.raw);
    try {
      await repo.saveRoute(route);
      toast.show(`Маршрут «${name}» сохранён · ${formatDistance(route.distanceM)}.`);
      setSaving(false);
      navigate(thenSimulate ? `/activity?route=${route.id}` : '/routes', { replace: true });
    } catch (error) {
      toast.show(describeStorageError(error), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const back = () => (dirty ? setConfirm('leave') : navigate('/routes', { replace: true }));

  if (loadState === 'loading') {
    return <div className="center-pad" aria-busy="true"><span className="spinner" aria-label="Загрузка маршрута" /></div>;
  }
  if (loadState !== 'ready') {
    return (
      <div className="screen-body" style={{ paddingTop: 'calc(var(--safe-top) + 24px)' }}>
        <Banner kind="danger" icon="alert">
          {loadState === 'missing' ? 'Маршрут не найден: возможно, он был удалён.' : 'Не удалось открыть маршрут.'}
        </Banner>
        <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 16 }} onClick={() => navigate('/routes', { replace: true })}>
          К списку маршрутов
        </button>
      </div>
    );
  }

  const fitKey = original?.id ?? 'new';
  const hint =
    tool === 'points'
      ? controlCount === 0 && state.kind === 'path'
        ? 'Коснитесь карты, чтобы поставить первую точку'
        : 'Касание карты добавляет точку · перетащите точку, чтобы сдвинуть'
      : tool === 'draw'
        ? 'Ведите пальцем по карте, чтобы нарисовать линию'
        : 'Двигайте и масштабируйте карту, маршрут не изменится';

  return (
    <div className="editor">
      <LeafletMap
        className="editor-map"
        label="Карта редактора маршрута"
        tileUrl={tileUrl}
        onReady={setMapRef}
      >
        {original ? <FitBounds coords={original.coords} fitKey={fitKey} /> : null}
        <EditorLayer
          tool={tool}
          state={state}
          geometry={geometry}
          selected={selected}
          onAdd={onAdd}
          onMove={onMove}
          onSelect={setSelected}
          onInsert={onInsert}
          onStroke={onStroke}
          onRawTap={() => undefined}
        />
        <MapControls onLocate={locate} locating={locating} />
        <ClearSelectionOnTool tool={tool} onClear={() => setSelected(null)} />
      </LeafletMap>

      <header className="editor-top">
        <button type="button" className="icon-btn filled" aria-label="Назад" onClick={back}>
          <Icon name="back" />
        </button>
        <div className="editor-chip" aria-live="polite">
          <strong>{formatDistance(distance)}</strong>
          <span className="muted"> · {count.toLocaleString('ru-RU')} т.</span>
          {pending > 0 ? <span className="spinner" aria-label="Строим по улицам" /> : null}
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={openSave}>
          Сохранить
        </button>
      </header>

      {state.kind === 'raw' && tool === 'points' && count > 0 ? (
        <div className="editor-banner">
          <Banner kind="info" icon="info">
            <div>
              Это готовая линия из {count.toLocaleString('ru-RU')} точек. Чтобы двигать точки, её нужно упростить до опорных точек.
            </div>
            <button type="button" className="btn btn-sm btn-primary" style={{ marginTop: 8 }} onClick={convertRaw}>
              Упростить и редактировать
            </button>
          </Banner>
        </div>
      ) : null}

      <div className="editor-panel">
        <p className="editor-hint small muted">{hint}</p>
        <Segmented<Tool>
          label="Режим редактора"
          value={tool}
          onChange={(t) => {
            setTool(t);
            setSelected(null);
          }}
          options={[
            { value: 'points', label: 'Точки' },
            { value: 'draw', label: 'Рисовать' },
            { value: 'pan', label: 'Карта' },
          ]}
        />
        <div className="editor-actions">
          <button type="button" className="icon-btn" aria-label="Отменить действие" onClick={ed.undo} disabled={!ed.canUndo}>
            <Icon name="undo" />
          </button>
          <button type="button" className="icon-btn" aria-label="Вернуть действие" onClick={ed.redo} disabled={!ed.canRedo}>
            <Icon name="redo" />
          </button>
          <button
            type="button"
            className={`chip${useStreets ? ' on' : ''}`}
            aria-pressed={useStreets}
            disabled={!streetsAvailable}
            onClick={() => setStreets((v) => !v)}
            title={streetsAvailable ? 'Строить участки по пешеходным дорогам' : 'Включите построение по улицам в настройках'}
          >
            <Icon name="road" size={18} /> По улицам
          </button>
          <button type="button" className="icon-btn danger-text" aria-label="Удалить выбранную точку" onClick={deleteSelected} disabled={selected === null}>
            <Icon name="trash" />
          </button>
          <button type="button" className="icon-btn" aria-label="Ещё действия" onClick={() => setMenu(true)}>
            <Icon name="more" />
          </button>
        </div>
      </div>

      {menu ? (
        <Sheet title="Действия с маршрутом" onClose={() => setMenu(false)}>
          <div className="stack">
            <button type="button" className="btn btn-outline btn-block" onClick={reverse} disabled={count < 2}>
              <Icon name="repeat" size={20} /> Развернуть направление
            </button>
            <button type="button" className="btn btn-outline btn-block" onClick={closeLoop} disabled={state.kind !== 'path' || controlCount < 3}>
              <Icon name="loop" size={20} /> Замкнуть в кольцо
            </button>
            {state.kind === 'raw' && count > 100 ? (
              <button type="button" className="btn btn-outline btn-block" onClick={simplifyRaw}>
                <Icon name="route" size={20} /> Сократить число точек вдвое
              </button>
            ) : null}
            <button type="button" className="btn btn-outline btn-block" onClick={() => void exportCurrent()} disabled={count < 2}>
              <Icon name="share" size={20} /> Экспорт в GPX
            </button>
            <button type="button" className="btn btn-outline btn-block danger-text" onClick={() => { setMenu(false); setConfirm('clear'); }} disabled={count === 0}>
              <Icon name="trash" size={20} /> Очистить карту
            </button>
          </div>
          {!streetsAvailable ? (
            <p className="muted small" style={{ marginTop: 12 }}>
              Построение по улицам выключено или адрес сервиса указан неверно — маршрут строится прямыми линиями.
            </p>
          ) : null}
        </Sheet>
      ) : null}

      {saving ? (
        <NameSheet
          title="Сохранить маршрут"
          initial={saveName}
          confirmLabel="Сохранить"
          busy={busy}
          onClose={() => setSaving(false)}
          onSave={(name) => void save(name, false)}
          extra={
            <NameSimulateButton onClick={(name) => void save(name, true)} getName={() => saveName} />
          }
        />
      ) : null}

      {confirm === 'leave' ? (
        <ConfirmDialog
          title="Выйти без сохранения?"
          message="Изменения маршрута не будут сохранены."
          confirmLabel="Выйти без сохранения"
          danger
          onConfirm={() => navigate('/routes', { replace: true })}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
      {confirm === 'clear' ? (
        <ConfirmDialog
          title="Очистить карту?"
          message="Все точки маршрута будут удалены. Это действие можно отменить кнопкой «Отменить»."
          confirmLabel="Очистить"
          danger
          onConfirm={() => {
            ed.commit(EMPTY_EDITOR);
            setSelected(null);
            setConfirm(null);
          }}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
    </div>
  );
}

/** «Сохранить и запустить» использует то же имя, что введено в поле. */
function NameSimulateButton({ onClick, getName }: { onClick: (name: string) => void; getName: () => string }) {
  return (
    <button
      type="button"
      className="btn btn-outline btn-block"
      onClick={(e) => {
        const form = (e.currentTarget as HTMLElement).closest('form');
        const input = form?.querySelector<HTMLInputElement>('#route-name');
        const name = (input?.value ?? getName()).trim();
        if (!name) {
          input?.focus();
          return;
        }
        onClick(name);
      }}
    >
      <Icon name="play" size={20} /> Сохранить и запустить симуляцию
    </button>
  );
}

function ClearSelectionOnTool({ tool, onClear }: { tool: Tool; onClear: () => void }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    map.on('movestart', onClear);
    return () => {
      map.off('movestart', onClear);
    };
  }, [map, tool, onClear]);
  return null;
}

export { buildGeometry };
