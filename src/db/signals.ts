/** signals テーブルの操作 */
import { getDb } from './client';
import { randomUUID } from 'crypto';

export interface SignalRow {
  id: string;
  date: string;
  symbol: string;
  action: 'BUY' | 'SELL';
  reason: string;
  meta_json: string | null;
}

export function insertSignal(sig: Omit<SignalRow, 'id'>): string {
  const id = randomUUID();
  getDb().prepare(`
    INSERT INTO signals (id, date, symbol, action, reason, meta_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, sig.date, sig.symbol, sig.action, sig.reason, sig.meta_json ?? null);
  return id;
}

export function getSignalsByDate(date: string): SignalRow[] {
  return getDb()
    .prepare<[string], SignalRow>('SELECT * FROM signals WHERE date=? ORDER BY rowid ASC')
    .all(date);
}

export function getAllSignals(): SignalRow[] {
  return getDb()
    .prepare<[], SignalRow>('SELECT * FROM signals ORDER BY date ASC, rowid ASC')
    .all();
}
