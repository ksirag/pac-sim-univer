// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { exportGpx, gpxFileName, parseGpx } from './gpx';
import { flatLength } from './geo';

const wrap = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="t" xmlns="http://www.topografix.com/GPX/1/1">${body}</gpx>`;

const track = (pts: string, name = 'Утренний бег') =>
  wrap(`<trk><name>${name}</name><trkseg>${pts}</trkseg></trk>`);

describe('parseGpx: корректные файлы', () => {
  it('читает трек и переводит координаты в порядок «широта, долгота»', () => {
    const r = parseGpx(track('<trkpt lat="55.7500" lon="37.6000"/><trkpt lat="55.7600" lon="37.6200"/>'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tracks).toHaveLength(1);
    expect(r.tracks[0]!.coords).toEqual([55.75, 37.6, 55.76, 37.62]);
    expect(r.tracks[0]!.name).toBe('Утренний бег');
    expect(r.tracks[0]!.distanceM).toBeGreaterThan(1000);
    expect(r.tracks[0]!.distanceM).toBeCloseTo(flatLength(r.tracks[0]!.coords), 6);
  });
  it('склеивает несколько сегментов одного трека', () => {
    const r = parseGpx(
      wrap('<trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="1" lon="2"/></trkseg><trkseg><trkpt lat="2" lon="2"/><trkpt lat="2" lon="3"/></trkseg></trk>'),
    );
    expect(r.ok && r.tracks[0]!.pointCount).toBe(4);
  });
  it('читает маршруты <rte>', () => {
    const r = parseGpx(wrap('<rte><name>Маршрут</name><rtept lat="10" lon="20"/><rtept lat="10.01" lon="20.01"/></rte>'));
    expect(r.ok && r.tracks[0]!.name).toBe('Маршрут');
  });
  it('несколько треков возвращаются списком с предупреждением', () => {
    const r = parseGpx(
      wrap(
        '<trk><name>А</name><trkseg><trkpt lat="1" lon="1"/><trkpt lat="1" lon="1.1"/></trkseg></trk>' +
          '<trk><name>Б</name><trkseg><trkpt lat="2" lon="2"/><trkpt lat="2" lon="2.1"/></trkseg></trk>',
      ),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tracks.map((t) => t.name)).toEqual(['А', 'Б']);
      expect(r.warnings.some((w) => /несколько треков/.test(w))).toBe(true);
    }
  });
  it('трек без имени получает имя по умолчанию', () => {
    const r = parseGpx(wrap('<trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="1" lon="1.1"/></trkseg></trk>'));
    expect(r.ok && r.tracks[0]!.name).toBe('Трек 1');
  });
  it('схлопывает повторяющиеся подряд точки', () => {
    const r = parseGpx(track('<trkpt lat="1" lon="1"/><trkpt lat="1" lon="1"/><trkpt lat="1" lon="1.1"/>'));
    expect(r.ok && r.tracks[0]!.pointCount).toBe(2);
  });
  it('игнорирует путевые точки, если есть трек', () => {
    const r = parseGpx(wrap('<wpt lat="5" lon="5"><name>кафе</name></wpt><trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="1" lon="1.1"/></trkseg></trk>'));
    expect(r.ok && r.tracks).toHaveLength(1);
  });
  it('время и высоту не требует', () => {
    const r = parseGpx(track('<trkpt lat="1" lon="1"><ele>10</ele><time>2026-01-01T00:00:00Z</time></trkpt><trkpt lat="1" lon="1.1"/>'));
    expect(r.ok).toBe(true);
  });
});

describe('parseGpx: некорректные файлы', () => {
  const fail = (text: string) => {
    const r = parseGpx(text);
    expect(r.ok).toBe(false);
    return r.ok ? '' : r.error;
  };
  it('пустая строка', () => expect(fail('   ')).toMatch(/пуст/i));
  it('не XML', () => expect(fail('это просто текст')).toMatch(/xml|повреждён/i));
  it('битый XML', () => expect(fail('<gpx><trk></gpx>')).toMatch(/повреждён|xml/i));
  it('XML, но не GPX', () => expect(fail('<?xml version="1.0"?><kml></kml>')).toMatch(/не GPX/));
  it('пустой трек', () => expect(fail(wrap('<trk><trkseg></trkseg></trk>'))).toMatch(/нет трека/));
  it('одна точка — это не трек', () => expect(fail(track('<trkpt lat="1" lon="1"/>'))).toMatch(/нет трека/));
  it('только путевые точки', () => expect(fail(wrap('<wpt lat="1" lon="1"/><wpt lat="2" lon="2"/>'))).toMatch(/путевые|нет трека/i));
  it('все точки одинаковые → нулевая длина', () => {
    // одинаковые подряд точки схлопываются в одну, поэтому трек пуст
    expect(fail(track('<trkpt lat="1" lon="1"/><trkpt lat="1" lon="1"/><trkpt lat="1" lon="1"/>'))).toMatch(/нет трека|нулев/);
  });
  it('координаты вне диапазона отбрасываются, и при нехватке точек — ошибка', () => {
    expect(fail(track('<trkpt lat="95" lon="10"/><trkpt lat="1" lon="200"/>'))).toMatch(/нет трека/);
  });
  it('слишком большой файл', () => {
    expect(fail('x'.repeat(26 * 1024 * 1024))).toMatch(/слишком большой/);
  });
});

describe('parseGpx: частично некорректные данные', () => {
  it('отбрасывает плохие точки и сообщает об этом', () => {
    const r = parseGpx(track('<trkpt lat="1" lon="1"/><trkpt lat="999" lon="1"/><trkpt lat="1" lon="1.1"/><trkpt lat="2" lon="2"/>'));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tracks[0]!.pointCount).toBe(3);
      expect(r.warnings.some((w) => /некорректн/.test(w))).toBe(true);
    }
  });
});

describe('parseGpx: большие файлы', () => {
  // jsdom разбирает DOM заметно медленнее настоящих браузеров, поэтому здесь умеренный размер.
  // Трек из 50 000 точек проверяется на реальном Chromium в e2e-тесте (e2e/app.spec.ts).
  it('разбирает 3 000 точек', () => {
    const pts: string[] = [];
    for (let i = 0; i < 3_000; i++) pts.push(`<trkpt lat="${(55 + i * 1e-5).toFixed(6)}" lon="${(37 + Math.sin(i / 100) * 0.01).toFixed(6)}"/>`);
    const r = parseGpx(track(pts.join('')));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tracks[0]!.pointCount).toBeGreaterThan(2_900);
  });
});

describe('exportGpx', () => {
  const route = { name: 'Парк & «набережная» <1>', coords: [55.75, 37.6, 55.76, 37.62, 55.77, 37.64] };
  it('даёт корректный GPX, который читается обратно без потерь', () => {
    const xml = exportGpx(route, new Date('2026-01-01T00:00:00Z'));
    const r = parseGpx(xml);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const back = r.tracks[0]!.coords;
    expect(back).toHaveLength(route.coords.length);
    route.coords.forEach((v, i) => expect(back[i]).toBeCloseTo(v, 6));
  });
  it('экранирует спецсимволы в названии', () => {
    const xml = exportGpx(route);
    expect(xml).toContain('Парк &amp; «набережная» &lt;1&gt;');
    expect(xml).not.toContain('<1>');
  });
  it('сохраняет порядок атрибутов lat/lon', () => {
    expect(exportGpx(route)).toContain('<trkpt lat="55.7500000" lon="37.6000000"/>');
  });
  it('имя файла безопасное', () => {
    expect(gpxFileName('Бег: утро/вечер?')).toBe('Бег утровечер.gpx');
    expect(gpxFileName('   ')).toBe('маршрут.gpx');
    expect(gpxFileName('a'.repeat(200)).length).toBeLessThanOrEqual(84);
  });
});
