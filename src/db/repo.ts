import { DEFAULT_SETTINGS, type ActiveRecord, type Activity, type Route, type Settings } from '../core/types';
import { duplicateRoute, newId } from '../core/routeModel';
import { validateSettings } from '../core/validate';
import type { BackupFile } from '../core/backup';
import { SCHEMA_VERSION } from '../core/schema';
import type { PacerDB } from './db';

export class StorageError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'StorageError';
    this.cause = cause;
  }
}

export function describeStorageError(error: unknown): string {
  if (error instanceof StorageError) return error.message;
  const name = error instanceof Error ? error.name : '';
  if (name === 'QuotaExceededError') return 'Не хватает места на устройстве. Освободите память или удалите старые записи.';
  if (name === 'InvalidStateError' || name === 'SecurityError' || name === 'OpenFailedError') {
    return 'Хранилище браузера недоступно (возможно, включён приватный режим). Данные не будут сохранены.';
  }
  return 'Не удалось выполнить операцию с хранилищем данных.';
}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError(describeStorageError(error), error);
  }
}

export type ImportMode = 'merge' | 'replace';

export class Repo {
  constructor(readonly db: PacerDB) {}

  /** Открывает базу и проверяет версию схемы. */
  async init(): Promise<void> {
    await guard(async () => {
      await this.db.open();
      const row = await this.db.meta.get('schemaVersion');
      const stored = typeof row?.value === 'number' ? row.value : 0;
      if (stored > SCHEMA_VERSION) {
        throw new StorageError('Данные созданы более новой версией приложения. Обновите приложение.');
      }
      // здесь будут шаги миграции при росте SCHEMA_VERSION (stored < SCHEMA_VERSION)
      if (stored !== SCHEMA_VERSION) await this.db.meta.put({ key: 'schemaVersion', value: SCHEMA_VERSION });
    });
  }

  async schemaVersion(): Promise<number> {
    const row = await guard(() => this.db.meta.get('schemaVersion'));
    return typeof row?.value === 'number' ? row.value : 0;
  }

  // ── маршруты ──
  listRoutes(): Promise<Route[]> {
    return guard(() => this.db.routes.orderBy('updatedAt').reverse().toArray());
  }
  getRoute(id: string): Promise<Route | undefined> {
    return guard(() => this.db.routes.get(id));
  }
  async saveRoute(route: Route): Promise<Route> {
    const saved = { ...route, updatedAt: Math.max(route.updatedAt, Date.now()) };
    await guard(() => this.db.routes.put(saved));
    return saved;
  }
  async renameRoute(id: string, name: string): Promise<Route> {
    return guard(async () => {
      const route = await this.db.routes.get(id);
      if (!route) throw new StorageError('Маршрут не найден.');
      const next = { ...route, name: name.trim() || route.name, updatedAt: Date.now() };
      await this.db.routes.put(next);
      return next;
    });
  }
  async copyRoute(id: string): Promise<Route> {
    return guard(async () => {
      const route = await this.db.routes.get(id);
      if (!route) throw new StorageError('Маршрут не найден.');
      const copy = duplicateRoute(route, newId(), Date.now());
      await this.db.routes.put(copy);
      return copy;
    });
  }
  deleteRoute(id: string): Promise<void> {
    return guard(() => this.db.routes.delete(id));
  }

  // ── история ──
  listActivities(order: 'desc' | 'asc' = 'desc'): Promise<Activity[]> {
    return guard(async () => {
      const list = await this.db.activities.orderBy('startedAt').toArray();
      return order === 'desc' ? list.reverse() : list;
    });
  }
  getActivity(id: string): Promise<Activity | undefined> {
    return guard(() => this.db.activities.get(id));
  }
  async addActivity(activity: Activity): Promise<void> {
    await guard(() => this.db.activities.put(activity));
  }
  deleteActivity(id: string): Promise<void> {
    return guard(() => this.db.activities.delete(id));
  }

  // ── незавершённая активность ──
  getActive(): Promise<ActiveRecord | undefined> {
    return guard(() => this.db.active.get('current'));
  }
  async saveActive(record: ActiveRecord): Promise<void> {
    await guard(() => this.db.active.put(record));
  }
  clearActive(): Promise<void> {
    return guard(() => this.db.active.delete('current'));
  }

  /** Завершение: запись в историю и очистка незавершённой активности — одной транзакцией. */
  completeActivity(activity: Activity): Promise<void> {
    return guard(() =>
      this.db.transaction('rw', this.db.activities, this.db.active, async () => {
        await this.db.activities.put(activity);
        await this.db.active.delete('current');
      }),
    );
  }

  // ── настройки ──
  async getSettings(): Promise<Settings> {
    const rows = await guard(() => this.db.settings.toArray());
    const raw: Record<string, unknown> = {};
    for (const row of rows) raw[row.key] = row.value;
    return validateSettings({ ...DEFAULT_SETTINGS, ...raw });
  }
  async saveSettings(patch: Partial<Settings>): Promise<Settings> {
    const current = await this.getSettings();
    const next = validateSettings({ ...current, ...patch });
    await guard(() =>
      this.db.transaction('rw', this.db.settings, async () => {
        for (const [key, value] of Object.entries(next)) await this.db.settings.put({ key, value });
      }),
    );
    return next;
  }

  /** Удаляет все данные приложения на устройстве (маршруты, историю, незавершённую активность, настройки). */
  clearAll(): Promise<void> {
    return guard(() =>
      this.db.transaction('rw', [this.db.routes, this.db.activities, this.db.active, this.db.settings], async () => {
        await Promise.all([this.db.routes.clear(), this.db.activities.clear(), this.db.active.clear(), this.db.settings.clear()]);
      }),
    );
  }

  // ── резервные копии ──
  async applyBackup(backup: BackupFile, mode: ImportMode): Promise<{ routes: number; activities: number }> {
    return guard(() =>
      this.db.transaction('rw', [this.db.routes, this.db.activities, this.db.settings], async () => {
        let routes = 0;
        let activities = 0;
        if (mode === 'replace') {
          if (backup.scope === 'full') await this.db.routes.clear();
          await this.db.activities.clear();
        }
        for (const route of backup.routes) {
          const existing = mode === 'merge' ? await this.db.routes.get(route.id) : undefined;
          if (!existing || existing.updatedAt < route.updatedAt) {
            await this.db.routes.put(route);
            routes += 1;
          }
        }
        for (const activity of backup.activities) {
          if (mode === 'merge' && (await this.db.activities.get(activity.id))) continue;
          await this.db.activities.put(activity);
          activities += 1;
        }
        if (backup.settings && backup.scope === 'full' && mode === 'replace') {
          for (const [key, value] of Object.entries(backup.settings)) await this.db.settings.put({ key, value });
        }
        return { routes, activities };
      }),
    );
  }
}
