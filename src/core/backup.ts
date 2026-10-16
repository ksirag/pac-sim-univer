import { validateActivity, validateRoute, validateSettings } from './validate';
import { SCHEMA_VERSION } from './schema';
import type { Activity, Route, Settings } from './types';

export const BACKUP_APP = 'pacer-simulator';
export const MAX_BACKUP_CHARS = 80 * 1024 * 1024;

export interface BackupFile {
  app: typeof BACKUP_APP;
  kind: 'backup';
  schemaVersion: number;
  scope: 'full' | 'history';
  exportedAt: string;
  routes: Route[];
  activities: Activity[];
  settings?: Settings;
}

export type BackupParse =
  | { ok: true; backup: BackupFile; skipped: { routes: number; activities: number } }
  | { ok: false; error: string };

export function buildBackup(
  scope: BackupFile['scope'],
  data: { routes: Route[]; activities: Activity[]; settings: Settings },
  now: Date = new Date(),
): BackupFile {
  return {
    app: BACKUP_APP,
    kind: 'backup',
    schemaVersion: SCHEMA_VERSION,
    scope,
    exportedAt: now.toISOString(),
    routes: scope === 'full' ? data.routes : [],
    activities: data.activities,
    settings: scope === 'full' ? data.settings : undefined,
  };
}

/** Разбирает и проверяет файл резервной копии. Некорректные записи пропускаются и подсчитываются. */
export function parseBackup(text: string): BackupParse {
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, error: 'Файл пустой.' };
  if (text.length > MAX_BACKUP_CHARS) return { ok: false, error: 'Файл слишком большой.' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Файл повреждён: это не корректный JSON.' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: 'Неверный формат резервной копии.' };
  const obj = raw as Record<string, unknown>;
  if (obj.app !== BACKUP_APP || obj.kind !== 'backup') {
    return { ok: false, error: 'Это не резервная копия Pacer Simulator.' };
  }
  if (typeof obj.schemaVersion !== 'number' || !Number.isInteger(obj.schemaVersion) || obj.schemaVersion < 1) {
    return { ok: false, error: 'В файле не указана версия данных.' };
  }
  if (obj.schemaVersion > SCHEMA_VERSION) {
    return { ok: false, error: 'Копия создана более новой версией приложения. Обновите приложение и повторите.' };
  }
  if (!Array.isArray(obj.routes) || !Array.isArray(obj.activities)) {
    return { ok: false, error: 'В копии нет списков маршрутов и активностей.' };
  }
  const routes: Route[] = [];
  const activities: Activity[] = [];
  const skipped = { routes: 0, activities: 0 };
  const routeIds = new Set<string>();
  for (const r of obj.routes) {
    const v = validateRoute(r);
    if (v && !routeIds.has(v.id)) {
      routeIds.add(v.id);
      routes.push(v);
    } else skipped.routes += 1;
  }
  const activityIds = new Set<string>();
  for (const a of obj.activities) {
    const v = validateActivity(a);
    if (v && !activityIds.has(v.id)) {
      activityIds.add(v.id);
      activities.push(v);
    } else skipped.activities += 1;
  }
  if (routes.length === 0 && activities.length === 0 && (skipped.routes > 0 || skipped.activities > 0)) {
    return { ok: false, error: 'В файле нет ни одной корректной записи.' };
  }
  const scope = obj.scope === 'history' ? 'history' : 'full';
  const settings = obj.settings !== undefined ? validateSettings(obj.settings) : undefined;
  return {
    ok: true,
    backup: {
      app: BACKUP_APP,
      kind: 'backup',
      schemaVersion: obj.schemaVersion,
      scope,
      exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : '',
      routes,
      activities,
      settings,
    },
    skipped,
  };
}
