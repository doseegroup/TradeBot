/** 数学・統計ユーティリティ (v1.1) */

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

/** 最大ドローダウン（小数: 0.1 = 10%）を計算 */
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

/**
 * ATR (Average True Range) — n 期間の平均真の値幅
 * True Range = max(High − Low, |High − PrevClose|, |Low − PrevClose|)
 *
 * @param bars 古い→新しい順（period + 1 件以上必要）
 * @param period 計算期間（例: 14）
 * @returns ATR 値、データ不足時は null
 */
export function atr(
  bars: { high: number; low: number; close: number }[],
  period: number,
): number | null {
  if (bars.length < period + 1) return null;

  const recent = bars.slice(-(period + 1)); // period+1 件 → period 個の TR を計算
  let sumTR = 0;

  for (let i = 1; i < recent.length; i++) {
    const bar       = recent[i]!;
    const prevClose = recent[i - 1]!.close;
    const tr = Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - prevClose),
      Math.abs(bar.low  - prevClose),
    );
    sumTR += tr;
  }

  return sumTR / period;
}
