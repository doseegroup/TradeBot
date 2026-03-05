import type { IDataProvider, OHLCVBar } from '../types/index.js';

export type { IDataProvider, OHLCVBar };

/** 共通のリトライロジック付きフェッチ */
export async function fetchWithRetry(
  fn: () => Promise<OHLCVBar[]>,
  maxRetries = 3,
  delayMs = 2000,
): Promise<OHLCVBar[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }
  throw lastError;
}

/** YYYY-MM-DD 形式の日付を返す */
export function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** N日前の日付文字列 */
export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toDateString(d);
}
