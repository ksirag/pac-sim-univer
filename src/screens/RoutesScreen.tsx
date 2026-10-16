import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { exportGpx, gpxFileName, parseGpx, MAX_GPX_BYTES, type ParsedTrack } from '../core/gpx';
import { formatDistance } from '../core/format';
import { reduceToMaxPoints } from '../core/geo';
import { newId, routeFromGeometry } from '../core/routeModel';
import type { Route } from '../core/types';
import { describeStorageError } from '../db/repo';
import { useApp } from '../ui/AppContext';
import { FileReadError, readTextFile, saveTextFile } from '../ui/files';
import { isIOS } from '../ui/hooks';
import { Icon } from '../ui/Icon';
import { NameSheet } from '../ui/NameSheet';
import { Banner, EmptyState, ScreenHeader } from '../ui/parts';
import { RouteThumb } from '../ui/RouteThumb';
import { navigate } from '../ui/router';
import { ConfirmDialog, Sheet } from '../ui/Sheet';
import { useToast } from '../ui/toast';

const MAX_IMPORT_POINTS = 30_000;

export function RoutesScreen() {
  const { repo, setDraftRouteId } = useApp();
  const toast = useToast();
  const routes = useLiveQuery(() => repo.listRoutes(), [repo]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<Route | null>(null);
  const [renaming, setRenaming] = useState<Route | null>(null);
  const [deleting, setDeleting] = useState<Route | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [choose, setChoose] = useState<{ tracks: ParsedTrack[]; fileName: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function saveImported(track: ParsedTrack, fileName: string) {
    let coords = track.coords;
    const original = track.pointCount;
    if (original > MAX_IMPORT_POINTS) coords = reduceToMaxPoints(coords, MAX_IMPORT_POINTS);
    const now = Date.now();
    const baseName = track.name.startsWith('Трек ') ? fileName.replace(/\.[^.]+$/, '') || track.name : track.name;
    const route = routeFromGeometry({ id: newId(), name: baseName.slice(0, 80), source: 'gpx', createdAt: now, updatedAt: now }, coords);
    try {
      await repo.saveRoute(route);
      const note = original > MAX_IMPORT_POINTS ? ` Трек упрощён: было ${original} точек.` : '';
      toast.show(`Импортировано: «${route.name}» · ${formatDistance(route.distanceM)}.${note}`, {
        action: { label: 'Открыть', onClick: () => navigate(`/routes/${route.id}/edit`) },
      });
    } catch (error) {
      toast.show(describeStorageError(error), { kind: 'error' });
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setImportError(null);
    setImporting(true);
    try {
      const text = await readTextFile(file, MAX_GPX_BYTES);
      // даём интерфейсу перерисоваться (индикатор загрузки) до тяжёлого разбора
      await new Promise((r) => window.setTimeout(r, 30));
      const parsed = parseGpx(text);
      if (!parsed.ok) {
        setImportError(parsed.error);
        return;
      }
      if (parsed.tracks.length > 1) {
        setChoose({ tracks: parsed.tracks, fileName: file.name });
        return;
      }
      await saveImported(parsed.tracks[0]!, file.name);
      for (const w of parsed.warnings) toast.show(w);
    } catch (error) {
      setImportError(error instanceof FileReadError ? error.message : 'Не удалось импортировать файл.');
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function exportRoute(route: Route) {
    try {
      const result = await saveTextFile(gpxFileName(route.name), exportGpx(route), 'application/gpx+xml');
      if (result === 'downloaded') toast.show('Файл GPX скачан.');
    } catch {
      toast.show('Не удалось сохранить файл GPX.', { kind: 'error' });
    }
  }

  async function doDelete(route: Route) {
    setBusy(true);
    try {
      await repo.deleteRoute(route.id);
      toast.show(`Маршрут «${route.name}» удалён.`);
      setDeleting(null);
    } catch (error) {
      toast.show(describeStorageError(error), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const importButton = (
    <button type="button" className="btn btn-outline" onClick={() => fileInput.current?.click()} disabled={importing}>
      {importing ? <span className="spinner" aria-hidden /> : <Icon name="upload" size={20} />}
      Импорт GPX
    </button>
  );

  return (
    <>
      <ScreenHeader title="Маршруты" />
      <input
        ref={fileInput}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-label="Выбрать GPX-файл"
        data-testid="gpx-input"
        // На iPhone ограничение типов часто делает .gpx-файлы недоступными для выбора, поэтому проверяем содержимое сами
        accept={isIOS() ? undefined : '.gpx,application/gpx+xml,application/xml,text/xml'}
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <div className="screen-body">
        <div className="row" style={{ marginBottom: 12 }}>
          <button type="button" className="btn btn-primary grow" onClick={() => navigate('/routes/new')}>
            <Icon name="plus" size={20} />
            Новый маршрут
          </button>
          {importButton}
        </div>

        {importError ? (
          <div style={{ marginBottom: 12 }}>
            <Banner kind="danger" icon="alert">
              <strong>Не удалось импортировать GPX.</strong> {importError}
            </Banner>
          </div>
        ) : null}

        {routes === undefined ? (
          <div className="center-pad" aria-busy="true"><span className="spinner" aria-label="Загрузка" /></div>
        ) : routes.length === 0 ? (
          <EmptyState icon="route" title="Пока нет маршрутов" action={importButton}>
            Нарисуйте маршрут на карте или загрузите GPX-файл из другого приложения. Файл читается прямо на устройстве.
          </EmptyState>
        ) : (
          <ul className="list" aria-label="Сохранённые маршруты">
            {routes.map((r) => (
              <li key={r.id}>
                <button type="button" className="list-item" onClick={() => setMenu(r)} aria-label={`${r.name}, ${formatDistance(r.distanceM)}. Действия`}>
                  <RouteThumb coords={r.coords} />
                  <span className="grow">
                    <span className="list-title truncate" style={{ display: 'block' }}>{r.name}</span>
                    <span className="muted small">
                      {formatDistance(r.distanceM)} · {r.pointCount.toLocaleString('ru-RU')} точек{r.source === 'gpx' ? ' · GPX' : ''}
                    </span>
                  </span>
                  <Icon name="more" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {menu ? (
        <Sheet title={menu.name} onClose={() => setMenu(null)}>
          <div className="stack">
            <button type="button" className="btn btn-primary btn-block" onClick={() => { setDraftRouteId(menu.id); setMenu(null); navigate('/activity'); }}>
              <Icon name="play" size={20} /> Симулировать
            </button>
            <button type="button" className="btn btn-outline btn-block" onClick={() => { const id = menu.id; setMenu(null); navigate(`/routes/${id}/edit`); }}>
              <Icon name="edit" size={20} /> Открыть на карте и править
            </button>
            <button type="button" className="btn btn-outline btn-block" onClick={() => { const r = menu; setMenu(null); void exportRoute(r); }}>
              <Icon name="share" size={20} /> Экспорт в GPX
            </button>
            <button type="button" className="btn btn-outline btn-block" onClick={() => { setRenaming(menu); setMenu(null); }}>
              <Icon name="edit" size={20} /> Переименовать
            </button>
            <button
              type="button"
              className="btn btn-outline btn-block"
              onClick={async () => {
                const r = menu;
                setMenu(null);
                try {
                  const copy = await repo.copyRoute(r.id);
                  toast.show(`Создана копия: «${copy.name}».`);
                } catch (error) {
                  toast.show(describeStorageError(error), { kind: 'error' });
                }
              }}
            >
              <Icon name="copy" size={20} /> Сделать копию
            </button>
            <button type="button" className="btn btn-outline btn-block danger-text" onClick={() => { setDeleting(menu); setMenu(null); }}>
              <Icon name="trash" size={20} /> Удалить
            </button>
          </div>
        </Sheet>
      ) : null}

      {renaming ? (
        <NameSheet
          title="Переименовать маршрут"
          initial={renaming.name}
          confirmLabel="Сохранить"
          onClose={() => setRenaming(null)}
          onSave={async (name) => {
            try {
              await repo.renameRoute(renaming.id, name);
              setRenaming(null);
            } catch (error) {
              toast.show(describeStorageError(error), { kind: 'error' });
            }
          }}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title="Удалить маршрут?"
          message={<>Маршрут «{deleting.name}» будет удалён с этого устройства. Записи в истории останутся.</>}
          confirmLabel="Удалить"
          danger
          busy={busy}
          onConfirm={() => void doDelete(deleting)}
          onCancel={() => setDeleting(null)}
        />
      ) : null}

      {choose ? (
        <Sheet title="Выберите трек" onClose={() => setChoose(null)}>
          <p className="muted small" style={{ marginBottom: 12 }}>В файле несколько треков. Выберите, какой импортировать.</p>
          <ul className="list">
            {choose.tracks.map((t, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="list-item"
                  onClick={async () => {
                    const c = choose;
                    setChoose(null);
                    await saveImported(t, c.fileName);
                  }}
                >
                  <RouteThumb coords={t.coords} />
                  <span className="grow">
                    <span className="list-title truncate" style={{ display: 'block' }}>{t.name}</span>
                    <span className="muted small">{formatDistance(t.distanceM)} · {t.pointCount.toLocaleString('ru-RU')} точек</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Sheet>
      ) : null}
    </>
  );
}
