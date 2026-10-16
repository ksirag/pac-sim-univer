import Dexie, { type DexieOptions, type Table } from 'dexie';
import type { ActiveRecord, Activity, Route } from '../core/types';

export { SCHEMA_VERSION } from '../core/schema';

export interface SettingRow {
  key: string;
  value: unknown;
}
export interface MetaRow {
  key: string;
  value: unknown;
}

export class PacerDB extends Dexie {
  routes!: Table<Route, string>;
  activities!: Table<Activity, string>;
  active!: Table<ActiveRecord, string>;
  settings!: Table<SettingRow, string>;
  meta!: Table<MetaRow, string>;

  constructor(name = 'pacer-simulator', options?: DexieOptions) {
    super(name, options);
    this.version(1).stores({
      routes: 'id, updatedAt, name',
      activities: 'id, startedAt, mode, routeId',
      active: 'id',
      settings: 'key',
      meta: 'key',
    });
  }
}

export const db = new PacerDB();
