import { PacerDB } from './db';
import { Repo } from './repo';

/**
 * Запасной вариант, если IndexedDB недоступна (например, запрещена настройками браузера):
 * приложение работает, но данные живут только до закрытия вкладки. Пользователю об этом сообщается.
 */
export async function createMemoryRepo(): Promise<Repo> {
  const { IDBFactory, IDBKeyRange } = await import('fake-indexeddb');
  return new Repo(new PacerDB('pacer-memory', { indexedDB: new IDBFactory(), IDBKeyRange }));
}
