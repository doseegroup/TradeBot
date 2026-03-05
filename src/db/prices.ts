/** prices テーブルの操作 */
import { getDb } from './client';

export interface PriceRow {
  symbol: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** バルク upsert */
export function upsertPrices(rows: PriceRow[]): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO prices (symbol, date, open, high, low, close, volume)
    VALUES (@symbol, @date, @open, @high, @low, @close, @volume)
    ON CONFLICT(symbol, date) DO UPDATE SET
      open=excluded.open, high=excluded.high, low=excluded.low,
      close=excluded.close, volume=excluded.volume
  `);
  const insertMany = db.transaction((data: PriceRow[]) => data.forEach((r) => stmt.run(r)));
  insertMany(rows);
}

/** 最新日付を返す */
export function latestDate(symbol: string): string | null {
  const row = getDb()
    .prepare<[string], { date: string }>('SELECT date FROM prices WHERE symbol=? ORDER BY date DESC LIMIT 1')
    .get(symbol);
  return row?.date ?? null;
}

/** 指定日数分の履歴を古い→新しい順で返す */
export function getPriceBars(symbol: string, limit: number): PriceRow[] {
  return getDb()
    .prepare<[string, number], PriceRow>(
      'SELECT * FROM prices WHERE symbol=? ORDER BY date DESC LIMIT ?',
    )
    .all(symbol, limit)
    .reverse();
}

/** 特定日のバーを返す */
export function getBar(symbol: string, date: string): PriceRow | null {
  return (
    getDb()
      .prepare<[string, string], PriceRow>('SELECT * FROM prices WHERE symbol=? AND date=?')
      .get(symbol, date) ?? null
  );
}

/** 指定範囲のバーを返す（古い→新しい順） */
export function getPriceRange(symbol: string, startDate: string, endDate: string): PriceRow[] {
  return getDb()
    .prepare<[string, string, string], PriceRow>(
      'SELECT * FROM prices WHERE symbol=? AND date>=? AND date<=? ORDER BY date ASC',
    )
    .all(symbol, startDate, endDate);
}

/** DB に存在する全銘柄 */
export function allSymbols(): string[] {
  return getDb()
    .prepare<[], { symbol: string }>('SELECT DISTINCT symbol FROM prices')
    .all()
    .map((r) => r.symbol);
}
