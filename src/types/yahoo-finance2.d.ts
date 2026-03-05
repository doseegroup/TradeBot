/**
 * yahoo-finance2 は ESM のみ提供のため、tsx ランタイムでは動作するが
 * tsc (CommonJS モード) では型解決ができない。
 * 最低限の型宣言をここで補う。
 */
declare module 'yahoo-finance2' {
  interface HistoricalRow {
    date:     Date;
    open:     number | null;
    high:     number | null;
    low:      number | null;
    close:    number | null;
    adjClose: number | null;
    volume:   number | null;
  }

  interface YahooFinance {
    historical(
      symbol: string,
      opts: { period1: string; period2: string; interval?: string },
    ): Promise<HistoricalRow[]>;
  }

  const yahooFinance: YahooFinance;
  export default yahooFinance;
}
