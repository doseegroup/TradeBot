/** データプロバイダーの共通インターフェース */

export interface OHLCVBar {
  symbol: string;
  date: string;   // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IDataProvider {
  fetchDaily(symbol: string, startDate: string, endDate: string): Promise<OHLCVBar[]>;
}

/** 共通リトライロジック */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delayMs = 2000,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < maxRetries) await new Promise((r) => setTimeout(r, delayMs * i));
    }
  }
  throw lastErr;
}
