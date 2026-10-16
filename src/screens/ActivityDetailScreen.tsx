import { useEffect, useState } from 'react';
import { formatDateTime, formatDistance, formatDuration, formatKm, formatNumber, formatPace, formatSpeed } from '../core/format';
import type { Activity } from '../core/types';
import { describeStorageError } from '../db/repo';
import { useApp } from '../ui/AppContext';
import { Icon } from '../ui/Icon';
import { FitBounds, LeafletMap, PolylineLayer, StartEndMarkers } from '../ui/map/LeafletMap';
import { useMapColors } from '../ui/map/colors';
import { Banner, EmptyState, Metric, ScreenHeader } from '../ui/parts';
import { navigate } from '../ui/router';
import { ConfirmDialog } from '../ui/Sheet';
import { useToast } from '../ui/toast';

export function ActivityDetailScreen({ id }: { id: string }) {
  const { repo, tileUrl, setDraftRouteId } = useApp();
  const toast = useToast();
  const colors = useMapColors();
  const [activity, setActivity] = useState<Activity | null | undefined>(undefined);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    repo.getActivity(id).then(
      (a) => { if (!cancelled) setActivity(a ?? null); },
      (error) => { if (!cancelled) { setActivity(null); toast.show(describeStorageError(error), { kind: 'error' }); } },
    );
    return () => { cancelled = true; };
  }, [repo, id, toast]);

  const back = <button type="button" className="icon-btn" aria-label="Назад к истории" onClick={() => navigate('/history')}><Icon name="back" /></button>;

  if (activity === undefined) {
    return (<><ScreenHeader title="Активность" left={back} /><div className="center-pad" aria-busy="true"><span className="spinner" aria-label="Загрузка" /></div></>);
  }
  if (activity === null) {
    return (
      <>
        <ScreenHeader title="Активность" left={back} />
        <div className="screen-body">
          <EmptyState icon="alert" title="Запись не найдена" action={<button type="button" className="btn btn-primary" onClick={() => navigate('/history')}>К истории</button>}>
            Возможно, она была удалена.
          </EmptyState>
        </div>
      </>
    );
  }

  const a = activity;
  const isRun = a.mode === 'run';

  async function remove() {
    setBusy(true);
    try {
      await repo.deleteActivity(a.id);
      toast.show('Запись удалена.');
      navigate('/history', { replace: true });
    } catch (error) {
      toast.show(describeStorageError(error), { kind: 'error' });
      setBusy(false);
    }
  }

  return (
    <>
      <ScreenHeader title={isRun ? 'Бег' : 'Ходьба'} subtitle={formatDateTime(a.startedAt)} left={back} />
      <div className="screen-body">
        <div className="stack">
          {a.coords.length >= 4 ? (
            <div className="summary-map">
              <LeafletMap tileUrl={tileUrl} label="Маршрут активности" interactive={false}>
                <PolylineLayer coords={a.coords} color={isRun ? colors.run : colors.brand} weight={5} />
                <StartEndMarkers coords={a.coords} />
                <FitBounds coords={a.coords} fitKey={a.id} />
              </LeafletMap>
            </div>
          ) : (
            <Banner icon="info">Эта активность была без маршрута, карты нет.</Banner>
          )}
          <section className="card" aria-label="Показатели">
            <p className="muted small" style={{ marginBottom: 8 }}>Маршрут: {a.routeName}</p>
            <div className="metric-grid">
              <Metric big label="Дистанция" value={formatKm(a.distanceM)} unit="км" />
              <Metric big label="Время" value={formatDuration(a.durationS)} />
              <Metric label="Темп" value={formatPace(a.avgPaceSecPerKm)} unit="мин/км" />
              <Metric label="Скорость" value={formatSpeed(a.avgSpeedKmh)} unit="км/ч" />
              <Metric label="Шаги" value={formatNumber(a.steps)} />
              <Metric label="Длина шага" value={formatNumber(a.stepLengthM, 2)} unit="м" />
              <Metric label="Каденс" value={formatNumber(a.cadenceSpm)} unit="шаг/мин" />
              <Metric label="Калории (оценка)" value={formatNumber(a.caloriesKcal)} unit="ккал" />
            </div>
            <p className="muted small" style={{ marginTop: 8 }}>
              План: {formatDistance(a.plannedDistanceM)} за {formatDuration(a.plannedDurationS)}
              {a.endedEarly ? ' · завершено досрочно' : ''}. Калории оценены по формуле для веса {a.weightKg} кг. Данные рассчитаны симулятором, а не измерены.
            </p>
          </section>
          <div className="stack">
            {a.routeId ? (
              <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => { setDraftRouteId(a.routeId); navigate('/activity'); }}>
                <Icon name="repeat" size={22} /> Повторить на этом маршруте
              </button>
            ) : null}
            <button type="button" className="btn btn-outline btn-lg btn-block danger-text" onClick={() => setConfirm(true)}>
              <Icon name="trash" size={22} /> Удалить запись
            </button>
          </div>
        </div>
      </div>
      {confirm ? (
        <ConfirmDialog
          title="Удалить запись?"
          message="Запись будет удалена из истории без возможности восстановления."
          confirmLabel="Удалить"
          danger
          busy={busy}
          onConfirm={() => void remove()}
          onCancel={() => setConfirm(false)}
        />
      ) : null}
    </>
  );
}
