/** positions テーブルの操作 */
import { getDb } from './client';

export interface PositionRow {
  symbol: string;
  qty: number;
  avg_price: number;
  realized_pnl: number;
  updated_at: string;
  entry_date: string | null;
  entry_price: number | null;
  highest_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
}

export function upsertPosition(pos: PositionRow): void {
  getDb().prepare(`
    INSERT INTO positions
      (symbol, qty, avg_price, realized_pnl, updated_at,
       entry_date, entry_price, highest_price, stop_loss, take_profit)
    VALUES
      (@symbol, @qty, @avg_price, @realized_pnl, @updated_at,
       @entry_date, @entry_price, @highest_price, @stop_loss, @take_profit)
    ON CONFLICT(symbol) DO UPDATE SET
      qty=excluded.qty, avg_price=excluded.avg_price,
      realized_pnl=excluded.realized_pnl, updated_at=excluded.updated_at,
      entry_date=excluded.entry_date, entry_price=excluded.entry_price,
      highest_price=excluded.highest_price,
      stop_loss=excluded.stop_loss, take_profit=excluded.take_profit
  `).run(pos);
}

export function updateHighestPrice(symbol: string, price: number, updatedAt: string): void {
  getDb().prepare(`
    UPDATE positions SET highest_price=?, updated_at=? WHERE symbol=?
  `).run(price, updatedAt, symbol);
}

export function deletePosition(symbol: string): void {
  getDb().prepare('DELETE FROM positions WHERE symbol=?').run(symbol);
}

export function getPosition(symbol: string): PositionRow | null {
  return (
    getDb().prepare<[string], PositionRow>('SELECT * FROM positions WHERE symbol=?').get(symbol) ??
    null
  );
}

export function getAllPositions(): PositionRow[] {
  return getDb().prepare<[], PositionRow>('SELECT * FROM positions ORDER BY entry_date ASC').all();
}
