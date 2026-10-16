import { useEffect, useRef, useState } from 'react';
import { buildBackup, parseBackup, type BackupFile } from '../core/backup';
import { formatNumber } from '../core/format';
import { isHttpsUrl } from '../core/routing';
import { defaultStepLength } from '../core/metrics';
import { describeStorageError, type ImportMode } from '../db/repo';
import { useApp, isValidTileTemplate } from '../ui/AppContext';
import { FileReadError, readTextFile, saveTextFile } from '../ui/files';
import { isIOS, isStandalone } from '../ui/hooks';
import { Icon } from '../ui/Icon';
import { Banner, Field, ScreenHeader, Segmented } from '../ui/parts';
import { ConfirmDialog, Sheet } from '../ui/Sheet';
import { useToast } from '../ui/toast';

declare const __APP_VERSION__: string;
const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

export function SettingsScreen() {
  const { repo, settings, updateSettings, memoryMode, session } = useApp();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [weight, setWeight] = useState(String(settings.weightKg));
  const [height, setHeight] = useState(String(settings.heightCm));
  const [customRoute, setCustomRoute] = useState(settings.routingCustomUrl);
  const [customTiles, setCustomTiles] = useState(settings.tilesCustomUrl);
  const [pending, setPending] = useState<{ backup: BackupFile; skipped: { routes: number; activities: number } } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [wipe, setWipe] = useState(false);
  const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    navigator.storage?.estimate?.().then((e) => {
      if (!cancelled && e.usage !== undefined) setUsage(`${formatNumber((e.usage ?? 0) / 1024 / 1024, 1)} МБ`);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const w = Number(weight.replace(',', '.'));
  const h = Number(height.replace(',', '.'));
  const weightErr = !Number.isFinite(w) || w < 30 || w > 250 ? 'Вес от 30 до 250 кг' : null;
  const heightErr = !Number.isFinite(h) || h < 100 || h > 230 ? 'Рост от 100 до 230 см' : null;
  const routeUrlErr = customRoute && !isHttpsUrl(customRoute) ? 'Нужен адрес https:// (для localhost допустим http://)' : null;
  const tilesErr = customTiles && !isValidTileTemplate(customTiles) ? 'Нужен https-шаблон с {z}, {x} и {y}' : null;

  async function exportAll() {
    try {
      const [routes, activities] = await Promise.all([repo.listRoutes(), repo.listActivities('desc')]);
      const backup = buildBackup('full', { routes, activities, settings });
      const stamp = new Date().toISOString().slice(0, 10);
      const r = await saveTextFile(`pacer-backup-${stamp}.json`, JSON.stringify(backup), 'application/json');
      if (r === 'downloaded') toast.show('Резервная копия скачана.');
    } catch (error) {
      toast.show(describeStorageError(error), { kind: 'error' });
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setImportError(null);
    try {
      const text = await readTextFile(file, 80 * 1024 * 1024);
      const parsed = parseBackup(text);
      if (!parsed.ok) setImportError(parsed.error);
      else setPending({ backup: parsed.backup, skipped: parsed.skipped });
    } catch (error) {
      setImportError(error instanceof FileReadError ? error.message : 'Не удалось прочитать файл.');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function applyImport(mode: ImportMode) {
    if (!pending) return;
    setBusy(true);
    try {
      const r = await repo.applyBackup(pending.backup, mode);
      toast.show(`Импортировано: маршрутов ${r.routes}, активностей ${r.activities}.`);
      setPending(null);
    } catch (error) {
      toast.show(describeStorageError(error), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function wipeAll() {
    setBusy(true);
    try {
      await session.finish(false);
      await repo.clearAll();
      toast.show('Все данные удалены. Перезагружаю приложение…');
      window.setTimeout(() => window.location.reload(), 600);
    } catch (error) {
      toast.show(describeStorageError(error), { kind: 'error' });
      setBusy(false);
    }
  }

  return (
    <>
      <ScreenHeader title="Настройки" />
      <input
        ref={fileInput}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-label="Выбрать файл резервной копии"
        data-testid="backup-input"
        accept={isIOS() ? undefined : '.json,application/json'}
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <div className="screen-body">
        <div className="stack">
          {memoryMode ? (
            <Banner kind="warn" icon="alert">Хранилище браузера недоступно: данные хранятся только до закрытия приложения.</Banner>
          ) : null}

          <section className="card" aria-labelledby="s-profile">
            <h2 className="card-title" id="s-profile">Профиль для расчётов</h2>
            <div className="stack">
              <Field label="Вес" id="s-weight" error={weightErr} hint="Нужен для оценки калорий">
                <div className="input-group">
                  <input id="s-weight" className="input grow" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)}
                    onBlur={() => { if (!weightErr) void updateSettings({ weightKg: Math.round(w * 10) / 10 }); }} />
                  <span className="input-suffix">кг</span>
                </div>
              </Field>
              <Field label="Рост" id="s-height" error={heightErr} hint={`Нужен для длины шага по умолчанию (сейчас ≈ ${formatNumber(defaultStepLength('walk', settings.heightCm), 2)} м при ходьбе)`}>
                <div className="input-group">
                  <input id="s-height" className="input grow" inputMode="numeric" value={height} onChange={(e) => setHeight(e.target.value)}
                    onBlur={() => { if (!heightErr) void updateSettings({ heightCm: Math.round(h) }); }} />
                  <span className="input-suffix">см</span>
                </div>
              </Field>
            </div>
          </section>

          <section className="card" aria-labelledby="s-look">
            <h2 className="card-title" id="s-look">Оформление и поведение</h2>
            <div className="stack">
              <div>
                <p className="field-label">Тема</p>
                <Segmented label="Тема" value={settings.theme} onChange={(theme) => void updateSettings({ theme })}
                  options={[{ value: 'auto', label: 'Как в системе' }, { value: 'light', label: 'Светлая' }, { value: 'dark', label: 'Тёмная' }]} />
              </div>
              <div>
                <p className="field-label">Если приложение было закрыто во время активности</p>
                <Segmented label="Политика восстановления" value={settings.resumePolicy} onChange={(resumePolicy) => void updateSettings({ resumePolicy })}
                  options={[{ value: 'continue', label: 'Учесть время' }, { value: 'pause', label: 'Поставить на паузу' }]} />
                <p className="field-hint" style={{ marginTop: 6 }}>
                  {settings.resumePolicy === 'continue'
                    ? 'Симуляция продолжит считаться по часам, как будто вы всё это время шли.'
                    : 'Время вне приложения не засчитывается: активность встанет на паузу в момент последнего открытия.'}
                </p>
              </div>
            </div>
          </section>

          <section className="card" aria-labelledby="s-map">
            <h2 className="card-title" id="s-map">Карта и построение по улицам</h2>
            <div className="stack">
              <div className="switch-row">
                <span className="grow">
                  <span className="list-title" style={{ display: 'block' }}>Строить маршрут по улицам</span>
                  <span className="muted small">При выключении в редакторе рисуются прямые линии. Если сервис недоступен, редактор продолжает работать так же.</span>
                </span>
                <button type="button" role="switch" className="switch" aria-checked={settings.routingEnabled} aria-label="Строить маршрут по улицам" onClick={() => void updateSettings({ routingEnabled: !settings.routingEnabled })} />
              </div>
              {settings.routingEnabled ? (
                <>
                  <Segmented label="Сервис маршрутизации" value={settings.routingPreset} onChange={(routingPreset) => void updateSettings({ routingPreset })}
                    options={[{ value: 'fossgis-foot', label: 'Публичный (FOSSGIS)' }, { value: 'custom', label: 'Свой сервер' }]} />
                  {settings.routingPreset === 'fossgis-foot' ? (
                    <p className="muted small">Публичный сервис OSM-сообщества без гарантий и с ограничениями по частоте запросов. Для постоянной работы используйте свой OSRM-сервер.</p>
                  ) : (
                    <>
                      <Field label="Адрес OSRM-сервера" id="s-route-url" error={routeUrlErr} hint="Например https://router.example.com">
                        <input id="s-route-url" className="input" inputMode="url" autoCapitalize="none" autoCorrect="off" value={customRoute} onChange={(e) => setCustomRoute(e.target.value)}
                          onBlur={() => { if (!routeUrlErr) void updateSettings({ routingCustomUrl: customRoute.trim() }); }} />
                      </Field>
                      <Field label="Профиль" id="s-route-prof" hint="Обычно foot, walking или driving — как настроен ваш сервер">
                        <input id="s-route-prof" className="input" autoCapitalize="none" autoCorrect="off" value={settings.routingCustomProfile} onChange={(e) => void updateSettings({ routingCustomProfile: e.target.value })} />
                      </Field>
                    </>
                  )}
                </>
              ) : null}
              <hr className="sep" />
              <Segmented label="Источник карты" value={settings.tilesPreset} onChange={(tilesPreset) => void updateSettings({ tilesPreset })}
                options={[{ value: 'osm', label: 'OpenStreetMap' }, { value: 'custom', label: 'Свой источник' }]} />
              {settings.tilesPreset === 'custom' ? (
                <Field label="Шаблон адреса плиток" id="s-tiles" error={tilesErr} hint="https://tiles.example.com/{z}/{x}/{y}.png">
                  <input id="s-tiles" className="input" inputMode="url" autoCapitalize="none" autoCorrect="off" value={customTiles} onChange={(e) => setCustomTiles(e.target.value)}
                    onBlur={() => { if (!tilesErr) void updateSettings({ tilesCustomUrl: customTiles.trim() }); }} />
                </Field>
              ) : (
                <p className="muted small">Карта загружается из интернета, офлайн-карт нет. Публичные плитки OpenStreetMap подходят для умеренного личного использования.</p>
              )}
            </div>
          </section>

          <section className="card" aria-labelledby="s-data">
            <h2 className="card-title" id="s-data">Данные на устройстве</h2>
            <p className="muted small" style={{ marginBottom: 12 }}>
              Маршруты, история и настройки хранятся только на этом устройстве и никуда не отправляются.{usage ? ` Занято: ${usage}.` : ''} Если очистить данные Safari или удалить приложение, они пропадут — делайте резервные копии.
            </p>
            <div className="stack">
              <button type="button" className="btn btn-outline btn-block" onClick={() => void exportAll()}>
                <Icon name="download" size={20} /> Экспорт всех данных (JSON)
              </button>
              <button type="button" className="btn btn-outline btn-block" onClick={() => fileInput.current?.click()}>
                <Icon name="upload" size={20} /> Импорт из резервной копии
              </button>
              {importError ? <Banner kind="danger" icon="alert"><strong>Не удалось импортировать.</strong> {importError}</Banner> : null}
              <button type="button" className="btn btn-outline btn-block danger-text" onClick={() => setWipe(true)}>
                <Icon name="trash" size={20} /> Удалить все данные
              </button>
            </div>
          </section>

          <section className="card" aria-labelledby="s-install">
            <h2 className="card-title" id="s-install">Установка на iPhone</h2>
            {isStandalone() ? (
              <Banner kind="ok" icon="check">Приложение запущено с экрана «Домой».</Banner>
            ) : (
              <button type="button" className="btn btn-outline btn-block" onClick={() => setHelp(true)}>
                <Icon name="home" size={20} /> Как добавить на экран «Домой»
              </button>
            )}
          </section>

          <section className="card" aria-labelledby="s-about">
            <h2 className="card-title" id="s-about">О приложении</h2>
            <p className="small">Pacer Simulator, версия {VERSION}.</p>
            <ul className="plain-list muted small" style={{ marginTop: 8 }}>
              <li>Это симулятор: шаги, темп и дистанция рассчитываются по заданным вами параметрам и не поступают с датчиков или GPS.</li>
              <li>Приложение не связано с Pacer и не интегрировано с «Здоровьем» (Apple Health); данные туда не записываются.</li>
              <li>Калории — оценка по формуле, а не измерение.</li>
              <li>Работа в фоне на iPhone не гарантируется: при возвращении в приложение расчёт восстанавливается по часам.</li>
              <li>Приложение работает офлайн, но карты требуют интернета.</li>
            </ul>
            <p className="muted small" style={{ marginTop: 8 }}>Карта: © участники <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>.</p>
          </section>
        </div>
      </div>

      {pending ? (
        <Sheet title="Импорт резервной копии" onClose={() => (busy ? undefined : setPending(null))}>
          <p className="muted">
            В файле: маршрутов — {pending.backup.routes.length}, активностей — {pending.backup.activities.length}.
            {pending.skipped.routes + pending.skipped.activities > 0
              ? ` Повреждённых записей пропущено: ${pending.skipped.routes + pending.skipped.activities}.`
              : ''}
          </p>
          <div className="stack" style={{ marginTop: 16 }}>
            <button type="button" className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={() => void applyImport('merge')}>Добавить к текущим данным</button>
            <button type="button" className="btn btn-outline btn-lg btn-block danger-text" disabled={busy} onClick={() => void applyImport('replace')}>Заменить текущие данные</button>
          </div>
        </Sheet>
      ) : null}

      {wipe ? (
        <ConfirmDialog title="Удалить все данные?" message="Будут удалены маршруты, история, текущая активность и настройки. Это нельзя отменить. Сначала сделайте резервную копию, если данные нужны." confirmLabel="Удалить всё" danger busy={busy} onConfirm={() => void wipeAll()} onCancel={() => setWipe(false)} />
      ) : null}

      {help ? (
        <Sheet title="Добавить на экран «Домой»" onClose={() => setHelp(false)}>
          <ol className="steps">
            <li>Откройте это приложение в <strong>Safari</strong> (в других браузерах на iPhone кнопка может отсутствовать).</li>
            <li>Нажмите кнопку <strong>«Поделиться»</strong> — квадрат со стрелкой вверх внизу экрана.</li>
            <li>Прокрутите список и выберите <strong>«На экран “Домой”»</strong>.</li>
            <li>Нажмите <strong>«Добавить»</strong>. Иконка появится на главном экране.</li>
          </ol>
          <p className="muted small" style={{ marginTop: 12 }}>Данные Safari и установленного приложения могут храниться отдельно: после установки перенесите их через резервную копию.</p>
        </Sheet>
      ) : null}
    </>
  );
}
