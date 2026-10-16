import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { formatDistance, formatDuration, formatKm, formatNumber, formatPace, formatSpeed } from '../core/format';
import { Path } from '../core/geo';
import { MODE_LIMITS } from '../core/metrics';
import {
  derivedText, initialForm, isClosedRoute, parsePlanForm, repeatNeeded, suggestRepeat, type PlanForm,
} from '../core/planForm';
import { snapshot } from '../core/simulation';
import type { ActivityMode, Route, SimParams } from '../core/types';
import { useApp } from '../ui/AppContext';
import { useNow } from '../ui/hooks';
import { Icon } from '../ui/Icon';
import { LeafletMap, MapControls, PinLayer, PolylineLayer, FitBounds, StartEndMarkers } from '../ui/map/LeafletMap';
import { useMapColors } from '../ui/map/colors';
import { Banner, EmptyState, Field, Metric, ScreenHeader, Segmented } from '../ui/parts';
import { navigate, useHashRoute } from '../ui/router';
import { ConfirmDialog } from '../ui/Sheet';

export function ActivityScreen() {
  const { session } = useApp();
  if (!session.loaded) {
    return (
      <>
        <ScreenHeader title="Активность" />
        <div className="center-pad" aria-busy="true"><span className="spinner" aria-label="Загрузка" /></div>
      </>
    );
  }
  if (session.active) return <LiveView />;
  if (session.lastFinished) return <SummaryView />;
  return <SetupView />;
}

/* ───────────────────────── настройка ───────────────────────── */

function SetupView() {
  const { repo, settings, draft, setDraft, draftRouteId, setDraftRouteId, session } = useApp();
  const route = useHashRoute();
  const routes = useLiveQuery(() => repo.listRoutes(), [repo]);
  const [form, setFormState] = useState<PlanForm>(() => draft ?? initialForm('walk', settings.heightCm));
  const [selectedId, setSelectedId] = useState<string | null>(draftRouteId);
  const [touched, setTouched] = useState(false);
  const [starting, setStarting] = useState(false);

  // маршрут из адреса (?route=ID) имеет приоритет
  const queryRoute = route.query.get('route');
  useEffect(() => {
    if (queryRoute) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- синхронизация выбора с адресом
      setSelectedId(queryRoute);
      setDraftRouteId(queryRoute);
      navigate('/activity', { replace: true });
    }
  }, [queryRoute, setDraftRouteId]);

  const selected: Route | null = useMemo(() => routes?.find((r) => r.id === selectedId) ?? null, [routes, selectedId]);
  const parsed = useMemo(() => parsePlanForm(form), [form]);

  function setForm(patch: Partial<PlanForm>) {
    setFormState((prev) => {
      const next = { ...prev, ...patch };
      setDraft(next);
      return next;
    });
  }

  function changeMode(mode: ActivityMode) {
    if (mode === form.mode) return;
    const fresh = initialForm(mode, settings.heightCm);
    setForm({
      mode,
      pace: form.derive === 'pace' ? form.pace : fresh.pace,
      stepLength: form.stepTouched ? form.stepLength : fresh.stepLength,
    });
  }

  function selectRoute(id: string | null) {
    setSelectedId(id);
    setDraftRouteId(id);
    const r = routes?.find((x) => x.id === id);
    if (r) setForm({ repeat: suggestRepeat(r.coords) });
  }

  const plan = parsed.result.ok ? parsed.result.plan : null;
  const needRepeat = plan && selected ? repeatNeeded(plan.distanceM, selected.distanceM) : false;
  const errors = !parsed.result.ok ? parsed.result.errors : [];
  const fieldErrs = parsed.fieldErrors;
  const canStart = !!plan && Object.keys(fieldErrs).length === 0;

  async function start() {
    setTouched(true);
    if (!plan || !canStart) return;
    setStarting(true);
    const params: SimParams = {
      mode: form.mode,
      routeId: selected?.id ?? null,
      routeName: selected?.name ?? 'Без маршрута',
      routeLengthM: selected?.distanceM ?? 0,
      repeat: needRepeat ? (form.repeat === 'none' ? suggestRepeat(selected!.coords) : form.repeat) : 'none',
      plan,
    };
    await session.start(params, selected?.coords ?? []);
    setStarting(false);
  }

  const limits = MODE_LIMITS[form.mode];
  const isDerived = (k: PlanForm['derive']) => form.derive === k;
  const showErr = (key: keyof typeof fieldErrs) => (touched || (form[key as keyof PlanForm] as string)?.length > 0 ? fieldErrs[key] ?? null : null);

  return (
    <>
      <ScreenHeader title="Активность" subtitle="Симулятор: показатели рассчитываются, а не измеряются" />
      <div className="screen-body">
        <div className="stack">
          <Segmented
            label="Режим"
            value={form.mode}
            onChange={changeMode}
            options={[{ value: 'walk', label: 'Ходьба' }, { value: 'run', label: 'Бег' }]}
          />

          <section className="card" aria-labelledby="route-h">
            <h2 className="card-title" id="route-h">Маршрут</h2>
            {routes === undefined ? (
              <span className="spinner" aria-label="Загрузка" />
            ) : routes.length === 0 ? (
              <EmptyState icon="route" title="Нет сохранённых маршрутов" action={
                <button type="button" className="btn btn-outline" onClick={() => navigate('/routes')}>Перейти к маршрутам</button>
              }>
                Можно запустить симуляцию и без маршрута — тогда будут только цифры. Чтобы увидеть движение на карте, добавьте маршрут.
              </EmptyState>
            ) : (
              <Field label="Выберите маршрут" id="route-select">
                <select id="route-select" className="input" value={selectedId ?? ''} onChange={(e) => selectRoute(e.target.value || null)}>
                  <option value="">Без маршрута (только цифры)</option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>{r.name} · {formatDistance(r.distanceM)}</option>
                  ))}
                </select>
              </Field>
            )}
            {selectedId && routes && !selected ? (
              <Banner kind="warn" icon="alert">Выбранный маршрут не найден — возможно, он удалён.</Banner>
            ) : null}
            {selected ? <p className="muted small" style={{ marginTop: 8 }}>Длина маршрута: {formatDistance(selected.distanceM)}</p> : null}
          </section>

          <section className="card" aria-labelledby="plan-h">
            <h2 className="card-title" id="plan-h">Параметры</h2>
            <Segmented
              label="Что вычислить"
              value={form.derive}
              onChange={(derive) => setForm({ derive })}
              options={[
                { value: 'duration', label: 'Время' },
                { value: 'pace', label: form.paceUnit === 'pace' ? 'Темп' : 'Скорость' },
                { value: 'distance', label: 'Дистанция' },
              ]}
            />
            <p className="muted small" style={{ margin: '8px 0 12px' }}>
              Задайте два параметра — третий посчитается автоматически.
            </p>

            <div className="stack">
              <Field label="Дистанция" id="f-distance" error={isDerived('distance') ? null : showErr('distance')} hint="В километрах, например 5 или 5,2">
                {isDerived('distance') ? (
                  <output className="input input-derived" id="f-distance" aria-label="Дистанция, км (вычисляется)">{derivedText(form, parsed)} км</output>
                ) : (
                  <div className="input-group">
                    <input id="f-distance" className="input grow" inputMode="decimal" autoComplete="off" value={form.distance} placeholder="5" aria-invalid={!!showErr('distance')} onChange={(e) => setForm({ distance: e.target.value })} />
                    <span className="input-suffix">км</span>
                  </div>
                )}
              </Field>

              <Field label="Время" id="f-duration" error={isDerived('duration') ? null : showErr('duration')} hint="45:00, 1:30:00 или минуты числом">
                {isDerived('duration') ? (
                  <output className="input input-derived" id="f-duration" aria-label="Время (вычисляется)">{derivedText(form, parsed)}</output>
                ) : (
                  <input id="f-duration" className="input" inputMode="numeric" autoComplete="off" value={form.duration} placeholder="45:00" aria-invalid={!!showErr('duration')} onChange={(e) => setForm({ duration: e.target.value })} />
                )}
              </Field>

              <Field label={form.paceUnit === 'pace' ? 'Темп' : 'Скорость'} id="f-pace" error={isDerived('pace') ? null : showErr('pace')} hint={form.paceUnit === 'pace' ? 'Минуты:секунды на километр, например 6:05' : 'Километры в час, например 9,5'}>
                {isDerived('pace') ? (
                  <output className="input input-derived" id="f-pace" aria-label="Темп (вычисляется)">{derivedText(form, parsed)} {form.paceUnit === 'pace' ? 'мин/км' : 'км/ч'}</output>
                ) : (
                  <div className="input-group">
                    <input id="f-pace" className="input grow" inputMode={form.paceUnit === 'pace' ? 'numeric' : 'decimal'} autoComplete="off" value={form.pace} aria-invalid={!!showErr('pace')} onChange={(e) => setForm({ pace: e.target.value })} />
                    <span className="input-suffix">{form.paceUnit === 'pace' ? 'мин/км' : 'км/ч'}</span>
                  </div>
                )}
              </Field>
              <Segmented
                label="Единицы темпа"
                value={form.paceUnit}
                onChange={(paceUnit) => {
                  // пересчитываем текущее значение в новые единицы
                  const p = parsePlanForm(form);
                  const patch: Partial<PlanForm> = { paceUnit };
                  if (p.result.ok && form.derive !== 'pace') {
                    patch.pace = derivedTextFor(paceUnit, p.result.plan.paceSecPerKm);
                  }
                  setForm(patch);
                }}
                options={[{ value: 'pace', label: 'Темп (мин/км)' }, { value: 'speed', label: 'Скорость (км/ч)' }]}
              />
            </div>

            <hr className="sep" />

            <Segmented
              label="Шаги"
              value={form.stepMode}
              onChange={(stepMode) => setForm({ stepMode })}
              options={[{ value: 'length', label: 'Длина шага' }, { value: 'count', label: 'Число шагов' }]}
            />
            <div style={{ marginTop: 12 }}>
              {form.stepMode === 'length' ? (
                <Field label="Длина шага" id="f-step" error={showErr('stepLength')} hint={`Обычно ${limits.step[0]}–${limits.step[1]} м. Подставлено по росту ${settings.heightCm} см.`}>
                  <div className="input-group">
                    <input id="f-step" className="input grow" inputMode="decimal" autoComplete="off" value={form.stepLength} onChange={(e) => setForm({ stepLength: e.target.value, stepTouched: true })} />
                    <span className="input-suffix">м</span>
                  </div>
                </Field>
              ) : (
                <Field label="Число шагов" id="f-steps" error={showErr('steps')} hint="Длина шага вычислится по дистанции">
                  <input id="f-steps" className="input" inputMode="numeric" autoComplete="off" value={form.steps} onChange={(e) => setForm({ steps: e.target.value })} />
                </Field>
              )}
            </div>
          </section>

          {plan ? (
            <section className="card plan-preview" aria-label="Итоговые параметры плана" aria-live="polite">
              <h2 className="card-title">План</h2>
              <div className="metric-grid">
                <Metric label="Дистанция" value={formatKm(plan.distanceM)} unit="км" />
                <Metric label="Время" value={formatDuration(plan.durationS)} />
                <Metric label="Темп" value={formatPace(plan.paceSecPerKm)} unit="мин/км" />
                <Metric label="Скорость" value={formatSpeed(plan.speedKmh)} unit="км/ч" />
                <Metric label="Шаги" value={formatNumber(plan.steps)} />
                <Metric label="Длина шага" value={formatNumber(plan.stepLengthM, 2)} unit="м" />
              </div>
              <p className="muted small" style={{ marginTop: 8 }}>Каденс около {formatNumber(plan.cadenceSpm)} шагов в минуту.</p>
            </section>
          ) : null}

          {errors.length > 0 && (touched || form.distance || form.duration) ? (
            <Banner kind="danger" icon="alert">
              <ul className="plain-list">
                {errors.map((e) => <li key={e}>{e}</li>)}
              </ul>
            </Banner>
          ) : null}
          {plan && plan.warnings.length > 0 ? (
            <Banner kind="warn" icon="alert">
              <ul className="plain-list">
                {plan.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            </Banner>
          ) : null}

          {needRepeat && selected ? (
            <section className="card" aria-labelledby="rep-h">
              <h2 className="card-title" id="rep-h">Дистанция длиннее маршрута</h2>
              <p className="muted small" style={{ marginBottom: 8 }}>
                Маршрут {formatDistance(selected.distanceM)}, а нужно пройти {formatDistance(plan!.distanceM)}. Что делать на «лишнем» участке?
              </p>
              <Segmented
                label="Повтор маршрута"
                value={form.repeat === 'none' ? suggestRepeat(selected.coords) : form.repeat}
                onChange={(repeat) => setForm({ repeat })}
                options={[{ value: 'loop', label: 'По кругу' }, { value: 'pingpong', label: 'Туда и обратно' }]}
              />
              {form.repeat === 'loop' && !isClosedRoute(selected.coords) ? (
                <p className="muted small" style={{ marginTop: 8 }}>Маршрут не замкнут: после финиша маркер сразу перейдёт к старту.</p>
              ) : null}
            </section>
          ) : null}

          <button type="button" className={`btn btn-lg btn-block ${form.mode === 'run' ? 'btn-run' : 'btn-primary'}`} onClick={() => void start()} disabled={starting || (touched && !canStart)}>
            <Icon name="play" size={22} /> Начать {form.mode === 'run' ? 'бег' : 'ходьбу'}
          </button>
          <p className="muted small center">
            Это симулятор: данные рассчитываются по заданным параметрам и не получаются с датчиков или GPS. Калории — оценка по формуле.
          </p>
        </div>
      </div>
    </>
  );
}

function derivedTextFor(unit: 'pace' | 'speed', paceSecPerKm: number): string {
  if (unit === 'pace') return formatPace(paceSecPerKm);
  return String(Math.round((3600 / paceSecPerKm) * 10) / 10).replace('.', ',');
}

/* ───────────────────────── активная симуляция ───────────────────────── */

function LiveView() {
  const { session, tileUrl } = useApp();
  const active = session.active!;
  const state = active.state;
  const running = state.status === 'running';
  const now = useNow(running);
  const colors = useMapColors();
  const path = useMemo(() => (active.coords.length >= 4 ? new Path(active.coords) : null), [active.coords]);
  const snap = snapshot(state, path, now);
  const p = state.params;
  const [confirm, setConfirm] = useState<null | 'finish' | 'discard'>(null);
  const isRun = p.mode === 'run';
  const remainingS = Math.max(0, p.plan.durationS - snap.elapsedS);

  return (
    <>
      <div className="live-map">
        {path ? (
          <LeafletMap tileUrl={tileUrl} label="Карта маршрута" interactive>
            <PolylineLayer coords={active.coords} color={isRun ? colors.run : colors.brand} weight={5} opacity={0.9} />
            <StartEndMarkers coords={active.coords} />
            <FitBounds coords={active.coords} fitKey={p.routeId ?? 'route'} />
            {snap.position ? <PinLayer lat={snap.position.lat} lng={snap.position.lng} kind="pos" /> : null}
            <MapControls />
          </LeafletMap>
        ) : (
          <div className="no-map">
            <Icon name={isRun ? 'run' : 'walk'} size={56} />
            <p className="muted">Симуляция без маршрута: карта не используется.</p>
          </div>
        )}
        <div className="live-status">
          <span className={`badge ${isRun ? 'badge-run' : ''}`}>
            <Icon name={isRun ? 'run' : 'walk'} size={16} /> {isRun ? 'Бег' : 'Ходьба'}
          </span>
          <span className={`badge ${running ? '' : 'badge-muted'}`} role="status">{running ? 'Идёт' : 'Пауза'}</span>
        </div>
      </div>

      <div className="live-panel">
        {session.awayMs !== null ? (
          <Banner kind="info" icon="info">
            Приложение было закрыто или свёрнуто около {formatDuration(session.awayMs / 1000)}.{' '}
            {state.params.plan ? 'Время и дистанция пересчитаны по часам.' : ''}{' '}
            <button type="button" className="link-btn" onClick={session.dismissAway}>Понятно</button>
          </Banner>
        ) : null}

        <div className="progress" role="progressbar" aria-label="Выполнение цели" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(snap.progress * 100)}>
          <span style={{ width: `${snap.progress * 100}%` }} />
        </div>
        <p className="muted small" style={{ margin: '4px 0 8px' }}>
          {Math.round(snap.progress * 100)}% · осталось {formatDuration(remainingS)} · маршрут «{p.routeName}»
        </p>

        <div className="metric-grid metric-grid-live">
          <Metric big label="Время" value={formatDuration(snap.elapsedS)} />
          <Metric big label="Дистанция" value={formatKm(snap.distanceM)} unit="км" />
          <Metric label="Темп" value={formatPace(snap.paceSecPerKm)} unit="мин/км" />
          <Metric label="Скорость" value={formatSpeed(snap.speedKmh)} unit="км/ч" />
          <Metric label="Шаги" value={formatNumber(snap.steps)} />
          <Metric label="Каденс" value={formatNumber(p.plan.cadenceSpm)} unit="шаг/мин" />
        </div>

        <div className="row live-actions">
          {running ? (
            <button type="button" className="btn btn-outline btn-lg grow" onClick={session.pause}>
              <Icon name="pause" size={22} /> Пауза
            </button>
          ) : (
            <button type="button" className={`btn btn-lg grow ${isRun ? 'btn-run' : 'btn-primary'}`} onClick={session.resume}>
              <Icon name="play" size={22} /> Продолжить
            </button>
          )}
          <button type="button" className="btn btn-danger btn-lg grow" onClick={() => setConfirm('finish')}>
            <Icon name="flag" size={22} /> Завершить
          </button>
        </div>
        <p className="muted small center">
          Симуляция считается по времени и не требует GPS. iOS может приостановить страницу в фоне — при возвращении расчёт восстановится по часам. Работа в фоне не гарантируется.
        </p>
      </div>

      {confirm === 'finish' ? (
        <ConfirmDialog
          title="Завершить активность?"
          message={snap.targetReached ? 'Цель достигнута. Активность будет сохранена в историю.' : `Выполнено ${Math.round(snap.progress * 100)}% плана. Можно сохранить результат или отменить запись.`}
          confirmLabel="Завершить и сохранить"
          onConfirm={() => { setConfirm(null); void session.finish(true); }}
          onCancel={() => setConfirm(null)}
          extra={
            <button type="button" className="btn btn-ghost btn-block danger-text" style={{ marginTop: 8 }} onClick={() => setConfirm('discard')}>
              Завершить без сохранения
            </button>
          }
        />
      ) : null}
      {confirm === 'discard' ? (
        <ConfirmDialog
          title="Не сохранять активность?"
          message="Результат будет потерян без возможности восстановления."
          confirmLabel="Не сохранять"
          danger
          onConfirm={() => { setConfirm(null); void session.finish(false); }}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
    </>
  );
}

/* ───────────────────────── итог ───────────────────────── */

function SummaryView() {
  const { session, tileUrl } = useApp();
  const a = session.lastFinished!;
  const colors = useMapColors();
  const isRun = a.mode === 'run';
  return (
    <>
      <ScreenHeader title="Итоги" />
      <div className="screen-body">
        <div className="stack">
          <Banner kind="ok" icon="check">
            {a.endedEarly ? 'Активность завершена досрочно и сохранена в историю.' : 'Цель выполнена. Активность сохранена в историю.'}
          </Banner>
          {a.coords.length >= 4 ? (
            <div className="summary-map">
              <LeafletMap tileUrl={tileUrl} label="Пройденный маршрут" interactive={false}>
                <PolylineLayer coords={a.coords} color={isRun ? colors.run : colors.brand} weight={5} />
                <StartEndMarkers coords={a.coords} />
                <FitBounds coords={a.coords} fitKey={a.id} />
              </LeafletMap>
            </div>
          ) : null}
          <section className="card" aria-label="Результаты">
            <div className="row-between" style={{ marginBottom: 12 }}>
              <span className={`badge ${isRun ? 'badge-run' : ''}`}><Icon name={isRun ? 'run' : 'walk'} size={16} /> {isRun ? 'Бег' : 'Ходьба'}</span>
              <span className="muted small">{a.routeName}</span>
            </div>
            <div className="metric-grid">
              <Metric big label="Дистанция" value={formatKm(a.distanceM)} unit="км" />
              <Metric big label="Время" value={formatDuration(a.durationS)} />
              <Metric label="Темп" value={formatPace(a.avgPaceSecPerKm)} unit="мин/км" />
              <Metric label="Скорость" value={formatSpeed(a.avgSpeedKmh)} unit="км/ч" />
              <Metric label="Шаги" value={formatNumber(a.steps)} />
              <Metric label="Калории (оценка)" value={formatNumber(a.caloriesKcal)} unit="ккал" />
            </div>
            <p className="muted small" style={{ marginTop: 8 }}>Калории — приблизительная оценка по формуле и вашему весу, а не измерение.</p>
          </section>
          <div className="stack">
            <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => { session.dismissFinished(); }}>
              <Icon name="repeat" size={22} /> Новая активность
            </button>
            <button type="button" className="btn btn-outline btn-lg btn-block" onClick={() => { const id = a.id; session.dismissFinished(); navigate(`/history/${id}`); }}>
              Открыть в истории
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
