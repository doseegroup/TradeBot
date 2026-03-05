/** 数学・統計ユーティリティ */

/** 単純移動平均（末尾 n 件） */
export function sma(values: number[], n: number): number | null {
  if (values.length < n) return null;
  const slice = values.slice(-n);
  return slice.reduce((s, v) => s + v, 0) / n;
}

/** 最大値 */
export function highest(values: number[]): number {
  return Math.max(...values);
}

/** 平均値 */
export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** 最大ドローダウン（パーセント）を計算 */
export function maxDrawdown(equities: number[]): number {
  if (equities.length === 0) return 0;
  let peak = equities[0]!;
  let maxDD = 0;
  for (const eq of equities) {
    if (eq > peak) peak = eq;
    const dd = peak > 0 ? (peak - eq) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

/** floor で株数を計算 */
export function calcShares(budget: number, price: number): number {
  if (price <= 0) return 0;
  return Math.floor(budget / price);
}
