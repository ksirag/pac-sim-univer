import type { ActivityMode } from './types';

/**
 * ОЦЕНКА расхода энергии по метаболическим уравнениям ACSM для ровной поверхности.
 * Это расчёт по формуле, а не измерение пульса или датчиков: реальный расход зависит
 * от рельефа, физиологии и техники. Значение нужно показывать только как «≈» и «оценка».
 *
 * ходьба: VO₂ = 0,1·v + 3,5;  бег: VO₂ = 0,2·v + 3,5  (v — м/мин, VO₂ — мл/кг/мин)
 * 1 л O₂ ≈ 5 ккал.
 */
export function estimateCalories(mode: ActivityMode, speedKmh: number, weightKg: number, durationS: number): number {
  if (![speedKmh, weightKg, durationS].every((v) => Number.isFinite(v) && v > 0)) return 0;
  const metersPerMin = (speedKmh * 1000) / 60;
  const vo2 = (mode === 'walk' ? 0.1 : 0.2) * metersPerMin + 3.5;
  const kcalPerMin = (vo2 * weightKg) / 1000 * 5;
  return Math.round(kcalPerMin * (durationS / 60));
}
