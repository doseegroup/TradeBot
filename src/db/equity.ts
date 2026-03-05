/** equity テーブルの操作 */
import { getDb } from './client';

export interface EquityRow {
  date: string;
  equity: number;
  drawdown: number;
}

export function upsertEquity(row: EquityRow): void {
  getDb().prepare(`
    INSERT INTO equity (date, equity, drawdown)
    VALUES (@date, @equity, @drawdown)
    ON CONFLICT(date) DO UPDATE SET equity=excluded.equity, drawdown=excluded.drawdown
  `).run(row);
}

export function getEquityHistory(limit = 365): EquityRow[] {
  return getDb()
    .prepare<[number], EquityRow>('SELECT * FROM equity ORDER BY date DESC LIMIT ?')
    .all(limit)
    .reverse();
}

export function getLatestEquity(): EquityRow | null {
  return (
    getDb().prepare<[], EquityRow>('SELECT * FROM equity ORDER BY date DESC LIMIT 1').get() ?? null
  );
}

/** 全取引の PnL から現在の総資産を計算 */
export function calcTotalEquity(initialEquity: number): number {
  const result = getDb()
    .prepare<[], { total: number | null }>(`
      SELECT SUM(f.qty * (f.price - p.entry_price) * CASE o.side WHEN 'SELL' THEN 1 ELSE 0 END) AS total
      FROM fills f
      JOIN orders o ON f.order_id = o.id
      JOIN (
        SELECT order_id, AVG(price) AS entry_price
        FROM fills f2
        JOIN orders o2 ON f2.order_id = o2.id
        WHERE o2.side = 'BUY'
        GROUP BY o2.symbol
      ) p ON o.symbol = p.order_id
    `)
    .get();
  // シンプルな計算: 初期資金 + 全クローズ済みポジションの PnL の合計
  // fills と orders から直接計算するのは複雑なので、positions の realized_pnl 合計を使う
  const realized = getDb()
    .prepare<[], { total: number | null }>('SELECT SUM(realized_pnl) AS total FROM positions')
    .get();

  // positions テーブルには現在の保有のみ。過去クローズ分は DB に直接保存しない。
  // equity テーブルから最後の値を取得してフォールバック
  const latest = getLatestEquity();
  return latest?.equity ?? initialEquity + (realized?.total ?? 0);
}
