import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { buildBackup } from '../core/backup';
import { formatDateShort, formatDateTime, formatDistance, formatDuration, formatKm, formatNumber, formatPace, formatWeekday } from '../core/format';
import { dailyBuckets, periodStats } from '../core/stats';
import type { Activity } from '../core/types';
import { describeStorageError } from '../db/repo';
import { useApp } from '../ui/AppContext';
import { saveTextFile } from '../ui/files';
import { Icon } from '../ui/Icon';
import { EmptyState, Metric, ScreenHeader, Segmented } from '../ui/parts';
import { navigate } from '../ui/router';
import { useToast } from '../ui/toast';

type SortKey = 'new' | 'old' | 'far' | 'long';

const SORTS: Record<SortKey, (a: Activity, b: Activity) => number> = {
  new: (a, b) => b.startedAt - a.startedAt,
  old: (a, b) => a.startedAt - b.startedAt,
  far: (a, b) => b.distanceM - a.distanceM,
  long: (a, b) => b.durationS - a.durationS,
};

export function HistoryScreen() {
  const { repo, settings } = useApp();
  const toast = useToast();
  const activities = useLiveQuery(() => repo.listActivities('desc'), [repo]);
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [sort, setSort] = useState<SortKey>('new');

  const stats = useMemo(() => (activities ? periodStats(activities, period) : null), [activities, period]);
  const buckets = useMemo(() => (activities ? dailyBuckets(activities, 7) : []), [activities]);
  const sorted = useMemo(() => (activities ? [...activities].sort(SORTS[sort]) : []), [activities, sort]);
  const maxBucket = Math.max(1, ...buckets.map((b) => b.distanceM));

  async function exportHistory() {
    try {
      const routes = await repo.listRoutes();
      const backup = buildBackup('history', { routes, activities: activities ?? [], settings });
      const stamp = new Date().toISOString().slice(0, 10);
      const result = await saveTextFile(`pacer-history-${stamp}.json`, JSON.stringify(backup), 'application/json');
      if (result === 'downloaded') toast.show('Файл истории скачан.');
    } catch (error) {
      toast.show(describeStorageError(error), { kind: 'error' });
    }
  }

  return (
    <>
      <ScreenHeader
        title="История"
        right={
          activities && activities.length > 0 ? (
            <button type="button" className="icon-btn" aria-label="Экспортировать историю в JSON" onClick={() => void exportHistory()}>
              <Icon name="download" />
            </button>
          ) : undefined
        }
      />
      <div className="screen-body">
        {activities === undefined ? (
          <div className="center-pad" aria-busy="true"><span className="spinner" aria-label="Загрузка" /></div>
        ) : activities.length === 0 ? (
          <EmptyState icon="history" title="История пока пуста" action={
            <button type="button" className="btn btn-primary" onClick={() => navigate('/activity')}>Начать активность</button>
          }>
            Завершённые симуляции появятся здесь. Все данные хранятся только на этом устройстве.
          </EmptyState>
        ) : (
          <div className="stack">
            <section className="card" aria-label="Статистика">
              <div className="row-between" style={{ marginBottom: 12 }}>
                <h2 className="card-title" style={{ margin: 0 }}>Статистика</h2>
                <Segmented label="Период" value={period} onChange={setPeriod} options={[{ value: 'week', label: 'Неделя' }, { value: 'month', label: 'Месяц' }]} />
              </div>
              {stats ? (
                <div className="metric-grid">
                  <Metric big label="Дистанция" value={formatKm(stats.distanceM)} unit="км" />
                  <Metric big label="Активностей" value={formatNumber(stats.count)} />
                  <Metric label="Время" value={formatDuration(stats.durationS)} />
                  <Metric label="Шаги" value={formatNumber(stats.steps)} />
                  <Metric label="Калории (оценка)" value={formatNumber(stats.caloriesKcal)} unit="ккал" />
                  <Metric label="Ходьба / бег" value={`${stats.walkCount} / ${stats.runCount}`} />
                </div>
              ) : null}
              <div className="bars" role="img" aria-label={`Дистанция за 7 дней: ${buckets.map((b) => `${formatWeekday(b.dayStart)} ${formatDistance(b.distanceM)}`).join(', ')}`}>
                {buckets.map((b) => (
                  <div key={b.dayStart} className="bar-col">
                    <div className="bar-track"><div className="bar" style={{ height: `${Math.max(b.distanceM > 0 ? 6 : 0, (b.distanceM / maxBucket) * 100)}%` }} /></div>
                    <span className="bar-label">{formatWeekday(b.dayStart)}</span>
                  </div>
                ))}
              </div>
            </section>

            <div className="row-between">
              <h2 className="section-title">Все активности · {activities.length}</h2>
              <label className="sort">
                <span className="sr-only">Сортировка</span>
                <select className="input input-sm" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Сортировка">
                  <option value="new">Сначала новые</option>
                  <option value="old">Сначала старые</option>
                  <option value="far">По дистанции</option>
                  <option value="long">По времени</option>
                </select>
              </label>
            </div>
            <ul className="list" aria-label="Список активностей">
              {sorted.map((a) => (
                <li key={a.id}>
                  <button type="button" className="list-item" onClick={() => navigate(`/history/${a.id}`)}>
                    <span className={`mode-dot ${a.mode === 'run' ? 'run' : ''}`}><Icon name={a.mode === 'run' ? 'run' : 'walk'} size={22} /></span>
                    <span className="grow">
                      <span className="list-title truncate" style={{ display: 'block' }}>{a.routeName}</span>
                      <span className="muted small">
                        {formatDateShort(a.startedAt)} · {formatDistance(a.distanceM)} · {formatDuration(a.durationS)} · {formatPace(a.avgPaceSecPerKm)} /км
                      </span>
                      <span className="sr-only">{formatDateTime(a.startedAt)}</span>
                    </span>
                    <Icon name="chevron" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
