import { describe, expect, it } from 'vitest';
import { BACKUP_APP, buildBackup, parseBackup } from './backup';
import { SCHEMA_VERSION } from './schema';
import { DEFAULT_SETTINGS } from './types';
import { freshRepo, makeActivity, makeRoute } from '../test-utils';

const data = () => ({
  routes: [makeRoute('r1'), makeRoute('r2')],
  activities: [makeActivity('a1'), makeActivity('a2', { startedAt: 1_700_000_100_000 })],
  settings: { ...DEFAULT_SETTINGS, weightKg: 80 },
});

describe('резервная копия: формат', () => {
  it('содержит версию схемы и признаки приложения', () => {
    const b = buildBackup('full', data(), new Date('2026-01-02T03:04:05Z'));
    expect(b).toMatchObject({ app: BACKUP_APP, kind: 'backup', schemaVersion: SCHEMA_VERSION, scope: 'full', exportedAt: '2026-01-02T03:04:05.000Z' });
  });
  it('экспорт истории не содержит маршрутов и настроек', () => {
    const b = buildBackup('history', data());
    expect(b.routes).toEqual([]);
    expect(b.settings).toBeUndefined();
    expect(b.activities).toHaveLength(2);
  });
  it('круговой обход через JSON без потерь', () => {
    const b = buildBackup('full', data());
    const r = parseBackup(JSON.stringify(b));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.backup.routes.map((x) => x.id)).toEqual(['r1', 'r2']);
      expect(r.backup.activities).toHaveLength(2);
      expect(r.backup.settings?.weightKg).toBe(80);
      expect(r.skipped).toEqual({ routes: 0, activities: 0 });
    }
  });
});

describe('резервная копия: валидация', () => {
  const err = (text: string) => {
    const r = parseBackup(text);
    expect(r.ok).toBe(false);
    return r.ok ? '' : r.error;
  };
  it('пустой файл, не JSON, не объект', () => {
    expect(err('')).toMatch(/пуст/);
    expect(err('{oops')).toMatch(/JSON/);
    expect(err('[]')).toMatch(/формат/);
    expect(err('42')).toMatch(/формат/);
  });
  it('чужой JSON', () => {
    expect(err(JSON.stringify({ hello: 'world' }))).toMatch(/не резервная копия/);
  });
  it('нет версии схемы', () => {
    expect(err(JSON.stringify({ app: BACKUP_APP, kind: 'backup', routes: [], activities: [] }))).toMatch(/версия/i);
  });
  it('версия новее поддерживаемой', () => {
    const b = { ...buildBackup('full', data()), schemaVersion: SCHEMA_VERSION + 5 };
    expect(err(JSON.stringify(b))).toMatch(/новее|новой/);
  });
  it('нет списков', () => {
    expect(err(JSON.stringify({ app: BACKUP_APP, kind: 'backup', schemaVersion: 1 }))).toMatch(/списков/);
  });
  it('пропускает битые записи и считает их', () => {
    const b = buildBackup('full', data());
    const raw = JSON.parse(JSON.stringify(b));
    raw.routes.push({ id: 'bad', name: 'x', coords: [1] }); // нечётная длина
    raw.routes.push({ id: 'r1', name: 'дубль', createdAt: 1, updatedAt: 1, coords: [1, 1, 2, 2] }); // повтор id
    raw.activities.push({ id: 'bad' });
    raw.activities.push(null);
    const r = parseBackup(JSON.stringify(raw));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.skipped).toEqual({ routes: 2, activities: 2 });
      expect(r.backup.routes).toHaveLength(2);
      expect(r.backup.activities).toHaveLength(2);
    }
  });
  it('координаты вне диапазона отвергают запись', () => {
    const raw = JSON.parse(JSON.stringify(buildBackup('full', data())));
    raw.routes[0].coords = [100, 10, 11, 12];
    const r = parseBackup(JSON.stringify(raw));
    expect(r.ok && r.skipped.routes).toBe(1);
  });
  it('если корректных записей нет совсем — ошибка', () => {
    const raw = { app: BACKUP_APP, kind: 'backup', schemaVersion: 1, routes: [{ id: 1 }], activities: [{ id: 2 }] };
    expect(err(JSON.stringify(raw))).toMatch(/нет ни одной/);
  });
  it('длина маршрута пересчитывается, а не берётся из файла', () => {
    const raw = JSON.parse(JSON.stringify(buildBackup('full', data())));
    raw.routes[0].distanceM = 999_999_999;
    const r = parseBackup(JSON.stringify(raw));
    expect(r.ok && r.backup.routes[0]!.distanceM).toBeLessThan(10_000);
  });
  it('значения настроек из файла проверяются', () => {
    const raw = JSON.parse(JSON.stringify(buildBackup('full', data())));
    raw.settings = { weightKg: -1, theme: 'x', resumePolicy: 'pause' };
    const r = parseBackup(JSON.stringify(raw));
    expect(r.ok && r.backup.settings).toMatchObject({ weightKg: DEFAULT_SETTINGS.weightKg, theme: 'auto', resumePolicy: 'pause' });
  });
});

describe('резервная копия: импорт в базу', () => {
  it('«заменить» полностью переносит данные в чистую базу', async () => {
    const source = freshRepo();
    await source.init();
    for (const r of data().routes) await source.saveRoute(r);
    for (const a of data().activities) await source.addActivity(a);
    await source.saveSettings({ weightKg: 77 });
    const backup = buildBackup('full', {
      routes: await source.listRoutes(),
      activities: await source.listActivities(),
      settings: await source.getSettings(),
    });
    const parsed = parseBackup(JSON.stringify(backup));
    if (!parsed.ok) throw new Error(parsed.error);

    const target = freshRepo();
    await target.init();
    await target.saveRoute(makeRoute('старый'));
    const counts = await target.applyBackup(parsed.backup, 'replace');
    expect(counts).toEqual({ routes: 2, activities: 2 });
    expect((await target.listRoutes()).map((r) => r.id).sort()).toEqual(['r1', 'r2']);
    expect(await target.listActivities()).toHaveLength(2);
    expect((await target.getSettings()).weightKg).toBe(77);
  });
  it('«объединить» не затирает существующее и не дублирует историю', async () => {
    const repo = freshRepo();
    await repo.init();
    await repo.saveRoute(makeRoute('r1', { name: 'Свежее', updatedAt: 9_999_999 }));
    await repo.addActivity(makeActivity('a1'));
    const parsed = parseBackup(JSON.stringify(buildBackup('full', data())));
    if (!parsed.ok) throw new Error(parsed.error);
    const counts = await repo.applyBackup(parsed.backup, 'merge');
    expect(counts).toEqual({ routes: 1, activities: 1 }); // r2 и a2
    expect((await repo.getRoute('r1'))!.name).toBe('Свежее'); // более новое осталось
    expect(await repo.listActivities()).toHaveLength(2);
  });
  it('импорт истории в режиме «заменить» не трогает маршруты', async () => {
    const repo = freshRepo();
    await repo.init();
    await repo.saveRoute(makeRoute('мой'));
    await repo.addActivity(makeActivity('старая'));
    const parsed = parseBackup(JSON.stringify(buildBackup('history', data())));
    if (!parsed.ok) throw new Error(parsed.error);
    await repo.applyBackup(parsed.backup, 'replace');
    expect((await repo.listRoutes()).map((r) => r.id)).toEqual(['мой']);
    expect((await repo.listActivities()).map((a) => a.id).sort()).toEqual(['a1', 'a2']);
  });
});
