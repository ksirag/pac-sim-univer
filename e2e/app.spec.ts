import { expect, test, type Page } from '@playwright/test';

// Прозрачный PNG 1×1: вместо настоящих плиток карты (в тестах внешняя сеть не используется).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test.beforeEach(async ({ page }) => {
  await page.route('**/tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  // Сервис маршрутизации «недоступен»: проверяем запасной вариант (прямые линии)
  await page.route('**/routing.openstreetmap.de/**', (r) => r.abort('failed'));
});

async function noHorizontalOverflow(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(0);
}

function gpx(points: number): string {
  const pts: string[] = [];
  for (let i = 0; i < points; i++) {
    const lat = 55.75 + (i / points) * 0.1;
    const lon = 37.6 + Math.sin(i / 500) * 0.01 + (i / points) * 0.05;
    pts.push(`<trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"></trkpt>`);
  }
  return `<?xml version="1.0"?><gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Большой трек</name><trkseg>${pts.join('')}</trkseg></trk></gpx>`;
}

async function drawRoute(page: Page, name: string) {
  await page.goto('/#/routes/new');
  const map = page.locator('.editor-map .map');
  await expect(map).toBeVisible();
  const box = (await map.boundingBox())!;
  for (const [fx, fy] of [[0.3, 0.3], [0.7, 0.35], [0.6, 0.6]] as const) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  }
  await expect(page.locator('.editor-chip')).toContainText('т.');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.getByLabel('Название').fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить', exact: true }).click();
}

test('навигация: четыре вкладки без горизонтального переполнения', async ({ page }) => {
  await page.goto('/');
  for (const [tab, title] of [['Активность', 'Активность'], ['Маршруты', 'Маршруты'], ['История', 'История'], ['Настройки', 'Настройки']] as const) {
    await page.getByRole('link', { name: tab }).click();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await noHorizontalOverflow(page);
  }
});

test('пустые состояния', async ({ page }) => {
  await page.goto('/#/routes');
  await expect(page.getByText('Пока нет маршрутов')).toBeVisible();
  await page.goto('/#/history');
  await expect(page.getByText('История пока пуста')).toBeVisible();
});

test('рисование маршрута, сохранение и запуск симуляции: пауза, продолжение, завершение, сохранение после перезагрузки', async ({ page }) => {
  await drawRoute(page, 'Тестовый круг');
  await page.goto('/#/routes');
  await expect(page.locator('.list-title', { hasText: 'Тестовый круг' })).toBeVisible();
  await noHorizontalOverflow(page);

  await page.goto('/#/activity');
  const value = await page.locator('#route-select option').nth(1).getAttribute('value');
  await page.locator('#route-select').selectOption(value!);
  await page.getByLabel('Дистанция').fill('0,1');
  await expect(page.locator('#f-duration')).toContainText('01:12');
  await page.getByRole('button', { name: /Начать/ }).click();

  await expect(page.getByRole('progressbar')).toBeVisible();
  await page.getByRole('button', { name: 'Пауза' }).click();
  await expect(page.getByRole('button', { name: 'Продолжить' })).toBeVisible();

  // активность переживает перезагрузку
  await page.reload();
  await expect(page.getByRole('button', { name: 'Продолжить' })).toBeVisible();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await expect(page.getByRole('button', { name: 'Пауза' })).toBeVisible();

  await page.getByRole('button', { name: 'Завершить', exact: true }).click();
  await page.getByRole('button', { name: 'Завершить и сохранить' }).click();
  await expect(page.getByText('Итоги')).toBeVisible();
  await page.getByRole('button', { name: 'Открыть в истории' }).click();
  await expect(page.getByText('Калории (оценка)')).toBeVisible();

  await page.goto('/#/history');
  await page.reload();
  await expect(page.getByRole('list', { name: 'Список активностей' }).getByRole('listitem')).toHaveCount(1);
  await noHorizontalOverflow(page);
});

test('импорт GPX: некорректный файл, пустой трек и большой трек (50 000 точек)', async ({ page }) => {
  await page.goto('/#/routes');
  const input = page.getByTestId('gpx-input');

  await input.setInputFiles({ name: 'bad.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from('это не xml') });
  await expect(page.getByText('Не удалось импортировать GPX.')).toBeVisible();

  await input.setInputFiles({ name: 'empty.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from('<gpx version="1.1"><trk><trkseg></trkseg></trk></gpx>') });
  await expect(page.getByText('Не удалось импортировать GPX.')).toBeVisible();

  const started = Date.now();
  await input.setInputFiles({ name: 'big.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpx(50_000)) });
  await expect(page.getByText('Большой трек').first()).toBeVisible({ timeout: 60_000 });
  const took = Date.now() - started;
  console.log(`Импорт 50 000 точек: ${took} мс`);
  expect(took).toBeLessThan(30_000);
});

test('манифест и сервис-воркер', async ({ page, request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.ok()).toBeTruthy();
  const manifest = await res.json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.lang).toBe('ru');
  await page.goto('/');
  const registered = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return !!reg.active;
  });
  expect(registered).toBe(true);
});

test('резервная копия: неверный файл отклоняется', async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByTestId('backup-input').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"a":1}') });
  await expect(page.getByText('Не удалось импортировать.')).toBeVisible();
  await noHorizontalOverflow(page);
});
