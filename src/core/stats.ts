import type { Activity } from './types';

export interface PeriodStats {
  count: number;
  distanceM: number;
  durationS: number;
  steps: number;
  caloriesKcal: number;
  walkCount: number;
  runCount: number;
}

/** Начало текущей недели (понедельник, 00:00 по местному времени) или месяца. */
export function periodStart(kind: 'week' | 'month', now: Date): number {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (kind === 'week') {
    const dow = (d.getDay() + 6) % 7; // понедельник = 0
    d.setDate(d.getDate() - dow);
  } else {
    d.setDate(1);
  }
  return d.getTime();
}

export function periodStats(activities: readonly Activity[], kind: 'week' | 'month', now: Date = new Date()): PeriodStats {
  const from = periodStart(kind, now);
  const to = now.getTime();
  const out: PeriodStats = { count: 0, distanceM: 0, durationS: 0, steps: 0, caloriesKcal: 0, walkCount: 0, runCount: 0 };
  for (const a of activities) {
    if (a.startedAt < from || a.startedAt > to) continue;
    out.count += 1;
    out.distanceM += a.distanceM;
    out.durationS += a.durationS;
    out.steps += a.steps;
    out.caloriesKcal += a.caloriesKcal;
    if (a.mode === 'walk') out.walkCount += 1;
    else out.runCount += 1;
  }
  return out;
}

export interface DayBucket {
  dayStart: number;
  distanceM: number;
  count: number;
}

/** Дистанция по дням за последние `days` дней (включая сегодня), от старых к новым. */
export function dailyBuckets(activities: readonly Activity[], days = 7, now: Date = new Date()): DayBucket[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const buckets: DayBucket[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    buckets.push({ dayStart: d.getTime(), distanceM: 0, count: 0 });
  }
  const first = buckets[0]!.dayStart;
  for (const a of activities) {
    if (a.startedAt < first || a.startedAt > now.getTime()) continue;
    const d = new Date(a.startedAt);
    const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const bucket = buckets.find((b) => b.dayStart === key);
    if (bucket) {
      bucket.distanceM += a.distanceM;
      bucket.count += 1;
    }
  }
  return buckets;
}
