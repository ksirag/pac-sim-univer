import { describe, expect, it } from 'vitest';
import { PacerDB } from './db';
import { Repo, StorageError, describeStorageError } from './repo';
import { SCHEMA_VERSION } from '../core/schema';
import { DEFAULT_SETTINGS, type ActiveRecord } from '../core/types';
import { autoFinishIfDue, elapsedMs, pause, reconcile, touch } from '../core/simulation';
import { makeActivity, makeRoute, freshRepo, sim } from '../test-utils';

describe('инициализация и версия схемы', () => {
  it('записывает версию схемы', async () => {
    const repo = freshRepo();
    await repo.init();
    expect(await repo.schemaVersion()).toBe(SCHEMA_VERSION);
  });
  it('повторная инициализация не ломает данные', async () => {
    const repo = freshRepo();
    await repo.init();
    await repo.saveRoute(makeRoute('a'));
    await repo.init();
    expect(await repo.listRoutes()).toHaveLength(1);
  });
  it('отказывается открывать данные более новой версии', async () => {
    const repo = freshRepo();
    await repo.init();
    await repo.db.meta.put({ key: 'schemaVersion', value: SCHEMA_VERSION + 1 });
    await expect(repo.init()).rejects.toBeInstanceOf(StorageError);
  });
});

describe('маршруты', () => {
  it('сохранение, чтение, список по дате изменения', async () => {
    const repo = freshRepo();
    await repo.init();
    await repo.saveRoute(makeRoute('a', { updatedAt: 1 }));
    await repo.saveRoute(makeRoute('b', { updatedAt: Date.now() + 5000 }));
    const list = await repo.listRoutes();
    expect(list.map((r) => r.id)).toEqual(['b', 'a']);
    expect((await repo.getRoute('a'))?.name).toBe('Маршрут a');
    expect(await repo.getRoute('нет')).toBeUndefined();
  });
  it('переименование: пустое имя игнорируется, пробелы обрезаются', async () => {
    const repo = freshRepo();
    await repo.init();
    await repo.saveRoute(makeRoute('a'));
    expect((await repo.renameRoute('a', '  Парк  ')).name).toBe('Парк');
    expect((await repo.renameRoute('a', '   ')).name).toBe('Парк');
    await expect(repo.renameRoute('нет', 'x')).rejects.toBeInstanceOf(StorageError);
  });
  it('копирование создаёт независимый маршрут', async () => {
    const repo = freshRepo();
    await repo.init();
    await repo.saveRoute(makeRoute('a'));
    const copy = await repo.copyRoute('a');
    expect(copy.id).not.toBe('a');
    expect(copy.name).toBe('Маршрут a (копия)');
    expect(copy.source).toBe('copy');
    expect(await repo.listRoutes()).toHaveLength(2);
    await expect(repo.copyRoute('нет')).rejects.toBeInstanceOf(StorageError);
  });
  it('удаление', async () => {
    const repo = freshRepo();
    await repo.init();
    await repo.saveRoute(makeRoute('a'));
    await repo.deleteRoute('a');
    expect(await repo.listRoutes()).toEqual([]);
  });
  it('большой маршрут (100 000 точек) сохраняется и читается', async () => {
    const repo = freshRepo();
    await repo.init();
    const coords: number[] = [];
    for (let i = 0; i < 100_000; i++) coords.push(55 + i * 1e-5, 37 + Math.sin(i / 500) * 0.01);
    await repo.saveRoute(makeRoute('big', { coords, pointCount: 100_000 }));
    const back = await repo.getRoute('big');
    expect(back!.coords).toHaveLength(200_000);
    expect(back!.coords[199_998]).toBe(coords[199_998]);
  });
});

describe('история', () => {
  it('сортировка по дате: новые сверху, по запросу — старые сверху', async () => {
    const repo = freshRepo();
    await repo.init();
    await repo.addActivity(makeActivity('old', { startedAt: 1000 }));
    await repo.addActivity(makeActivity('new', { startedAt: 3000 }));
    await repo.addActivity(makeActivity('mid', { startedAt: 2000 }));
    expect((await repo.listActivities()).map((a) => a.id)).toEqual(['new', 'mid', 'old']);
    expect((await repo.listActivities('asc')).map((a) => a.id)).toEqual(['old', 'mid', 'new']);
  });
  it('получение и удаление', async () => {
    const repo = freshRepo();
    await repo.init();
    await repo.addActivity(makeActivity('x'));
    expect((await repo.getActivity('x'))?.id).toBe('x');
    await repo.deleteActivity('x');
    expect(await repo.getActivity('x')).toBeUndefined();
  });
});

describe('настройки', () => {
  it('по умолчанию — значения по умолчанию', async () => {
    const repo = freshRepo();
    await repo.init();
    expect(await repo.getSettings()).toEqual(DEFAULT_SETTINGS);
  });
  it('сохраняются частично и переживают повторное чтение', async () => {
    const repo = freshRepo();
    await repo.init();
    await repo.saveSettings({ weightKg: 82, theme: 'dark' });
    const s = await repo.getSettings();
    expect(s.weightKg).toBe(82);
    expect(s.theme).toBe('dark');
    expect(s.heightCm).toBe(DEFAULT_SETTINGS.heightCm);
  });
  it('недопустимые значения заменяются безопасными', async () => {
    const repo = freshRepo();
    await repo.init();
    const s = await repo.saveSettings({ weightKg: -5, heightCm: 5000, theme: 'неон' as never });
    expect(s.weightKg).toBe(DEFAULT_SETTINGS.weightKg);
    expect(s.heightCm).toBe(DEFAULT_SETTINGS.heightCm);
    expect(s.theme).toBe('auto');
  });
});

describe('сохранение и загрузка после «перезагрузки»', () => {
  it('данные доступны из нового экземпляра базы с тем же именем', async () => {
    const name = `reload-${Date.now()}`;
    const first = new Repo(new PacerDB(name));
    await first.init();
    await first.saveRoute(makeRoute('a'));
    await first.addActivity(makeActivity('act'));
    await first.saveSettings({ weightKg: 91 });
    first.db.close();

    const second = new Repo(new PacerDB(name));
    await second.init();
    expect((await second.listRoutes()).map((r) => r.id)).toEqual(['a']);
    expect((await second.listActivities()).map((a) => a.id)).toEqual(['act']);
    expect((await second.getSettings()).weightKg).toBe(91);
  });
});

describe('незавершённая активность', () => {
  const rec = (state = sim(1_000_000)): ActiveRecord => ({ id: 'current', state, coords: [55.75, 37.6, 55.76, 37.62], savedAt: 1_000_000 });

  it('сохраняется, читается и очищается', async () => {
    const repo = freshRepo();
    await repo.init();
    expect(await repo.getActive()).toBeUndefined();
    await repo.saveActive(rec());
    expect((await repo.getActive())!.state.status).toBe('running');
    await repo.clearActive();
    expect(await repo.getActive()).toBeUndefined();
  });
  it('состояние паузы переживает перезагрузку', async () => {
    const name = `active-${Date.now()}`;
    const first = new Repo(new PacerDB(name));
    await first.init();
    await first.saveActive(rec(pause(sim(1_000_000), 1_040_000)));
    first.db.close();
    const second = new Repo(new PacerDB(name));
    await second.init();
    const restored = (await second.getActive())!;
    expect(restored.state.status).toBe('paused');
    expect(elapsedMs(restored.state, 9_999_999)).toBe(40_000);
  });
  it('запущенная активность восстанавливается по меткам времени', async () => {
    const name = `active-run-${Date.now()}`;
    const first = new Repo(new PacerDB(name));
    await first.init();
    await first.saveActive(rec(touch(sim(1_000_000), 1_030_000)));
    first.db.close();
    const second = new Repo(new PacerDB(name));
    await second.init();
    const restored = (await second.getActive())!;
    const continued = reconcile(restored.state, 1_200_000, 'continue');
    expect(continued.status).toBe('running');
    expect(elapsedMs(continued, 1_200_000)).toBe(200_000);
    const paused = reconcile(restored.state, 1_200_000, 'pause');
    expect(paused.status).toBe('paused');
    expect(elapsedMs(paused, 1_200_000)).toBe(30_000);
  });
  it('если цель достигнута, пока приложение было закрыто, активность завершается в момент цели', async () => {
    const repo = freshRepo();
    await repo.init();
    await repo.saveActive(rec());
    const restored = (await repo.getActive())!;
    const done = autoFinishIfDue(restored.state, 1_000_000 + 400_000);
    expect(done.status).toBe('finished');
    expect(done.finishedAt).toBe(1_000_000 + 360_000);
  });
  it('завершение записывает историю и очищает активность одной операцией', async () => {
    const repo = freshRepo();
    await repo.init();
    await repo.saveActive(rec());
    await repo.completeActivity(makeActivity('done'));
    expect(await repo.getActive()).toBeUndefined();
    expect((await repo.getActivity('done'))?.id).toBe('done');
  });
});

describe('ошибки хранилища', () => {
  it('понятные сообщения по типам ошибок', () => {
    const quota = Object.assign(new Error('q'), { name: 'QuotaExceededError' });
    expect(describeStorageError(quota)).toMatch(/места/);
    expect(describeStorageError(Object.assign(new Error('x'), { name: 'SecurityError' }))).toMatch(/недоступно/);
    expect(describeStorageError(new Error('что-то'))).toMatch(/Не удалось/);
    expect(describeStorageError(new StorageError('своё'))).toBe('своё');
  });
  it('операции над закрытой базой превращаются в StorageError', async () => {
    const repo = freshRepo();
    await repo.init();
    repo.db.close();
    await expect(repo.addActivity(makeActivity('a'))).rejects.toBeInstanceOf(StorageError);
  });
});
