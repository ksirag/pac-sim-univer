const nf1 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

export function formatNumber(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return '—';
  return digits === 0 ? nf0.format(value) : digits === 1 ? nf1.format(value) : nf2.format(value);
}

/** 850 м / 1,23 км */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return '—';
  if (meters < 1000) return `${nf0.format(Math.round(meters))} м`;
  return `${nf2.format(meters / 1000)} км`;
}

/** Только число километров, для крупных метрик. */
export function formatKm(meters: number): string {
  return Number.isFinite(meters) ? nf2.format(meters / 1000) : '—';
}

/** 05:07 или 1:05:07 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Темп из секунд на километр: 6:05 */
export function formatPace(secPerKm: number): string {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0 || secPerKm > 3600) return '—';
  const total = Math.round(secPerKm);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatSpeed(kmh: number): string {
  return Number.isFinite(kmh) ? nf1.format(kmh) : '—';
}

const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const dateShortFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const weekdayFmt = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' });

export function formatDate(ms: number): string {
  return dateFmt.format(new Date(ms));
}
export function formatDateShort(ms: number): string {
  return dateShortFmt.format(new Date(ms));
}
export function formatTime(ms: number): string {
  return timeFmt.format(new Date(ms));
}
export function formatDateTime(ms: number): string {
  return `${formatDate(ms)}, ${formatTime(ms)}`;
}
export function formatWeekday(ms: number): string {
  return weekdayFmt.format(new Date(ms));
}

/** Разбор «6:05», «6.05» или «365» (секунды) в секунды. Возвращает NaN при ошибке. */
export function parsePace(text: string): number {
  const t = text.trim().replace(',', '.');
  if (!t) return NaN;
  const m = /^(\d{1,3})[:.](\d{1,2})$/.exec(t);
  if (m) {
    const sec = Number(m[2]);
    if (sec >= 60) return NaN;
    return Number(m[1]) * 60 + sec;
  }
  return /^\d+$/.test(t) ? Number(t) : NaN;
}

/** Разбор «1:30:00», «45:00» или «45» (минуты) в секунды. NaN при ошибке. */
export function parseDuration(text: string): number {
  const t = text.trim();
  if (!t) return NaN;
  const parts = t.split(':');
  if (parts.length === 1) return /^\d+([.,]\d+)?$/.test(t) ? Number(t.replace(',', '.')) * 60 : NaN;
  if (parts.length > 3 || !parts.every((p) => /^\d+$/.test(p))) return NaN;
  const nums = parts.map(Number);
  if (nums.length === 2) return nums[1]! < 60 ? nums[0]! * 60 + nums[1]! : NaN;
  return nums[1]! < 60 && nums[2]! < 60 ? nums[0]! * 3600 + nums[1]! * 60 + nums[2]! : NaN;
}

/** Разбор десятичного числа с запятой или точкой. NaN при ошибке. */
export function parseDecimal(text: string): number {
  const t = text.trim().replace(',', '.');
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}
