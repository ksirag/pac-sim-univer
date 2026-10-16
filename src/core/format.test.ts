import { describe, expect, it } from 'vitest';
import { formatDistance, formatDuration, formatKm, formatPace, formatSpeed, parseDecimal, parseDuration, parsePace } from './format';

const nbsp = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

describe('форматирование', () => {
  it('дистанция', () => {
    expect(formatDistance(850)).toBe('850 м');
    expect(nbsp(formatDistance(1234))).toBe('1,23 км');
    expect(formatDistance(NaN)).toBe('—');
    expect(formatKm(5000)).toBe('5,00');
  });
  it('длительность', () => {
    expect(formatDuration(65)).toBe('01:05');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(-1)).toBe('—');
  });
  it('темп и скорость', () => {
    expect(formatPace(365)).toBe('6:05');
    expect(formatPace(299.6)).toBe('5:00');
    expect(formatPace(0)).toBe('—');
    expect(formatPace(Infinity)).toBe('—');
    expect(formatSpeed(9.84)).toBe('9,8');
  });
});

describe('разбор ввода', () => {
  it('темп', () => {
    expect(parsePace('6:05')).toBe(365);
    expect(parsePace('6.05')).toBe(365);
    expect(parsePace('365')).toBe(365);
    expect(parsePace('6:75')).toBeNaN();
    expect(parsePace('abc')).toBeNaN();
    expect(parsePace('')).toBeNaN();
  });
  it('длительность', () => {
    expect(parseDuration('45:00')).toBe(2700);
    expect(parseDuration('1:30:00')).toBe(5400);
    expect(parseDuration('45')).toBe(2700); // минуты
    expect(parseDuration('1:75')).toBeNaN();
    expect(parseDuration('1:2:3:4')).toBeNaN();
    expect(parseDuration('a:b')).toBeNaN();
    expect(parseDuration('')).toBeNaN();
  });
  it('десятичные числа с запятой и точкой', () => {
    expect(parseDecimal('5,5')).toBe(5.5);
    expect(parseDecimal('5.5')).toBe(5.5);
    expect(parseDecimal('-1')).toBeNaN();
    expect(parseDecimal('1e3')).toBeNaN();
  });
});
