/**
 * DB クエリ集
 * 全テーブルへのアクセスをここで一元管理する
 */
import { getDb } from './index.js';
import type { OHLCVBar, Position, Trade, Order, DailyRisk, Signal } from '../types/index.js';

// ─── OHLCV ───────────────────────────────────────────────────────────────────

export function upsertOHLCV(bars: OHLCVBar[]): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO ohlcv (symbol, date, open, high, low, close, volume)
    VALUES (@symbol, @date, @open, @high, @low, @close, @volume)
    ON CONFLICT(symbol, date) DO UPDATE SET
      open=excluded.open, high=excluded.high, low=excluded.low,
      close=excluded.close, volume=excluded.volume
  `);
  const insertMany = db.transaction((rows: OHLCVBar[]) => {
    for (const r of rows) stmt.run(r);
  });
  insertMany(bars);
}

export function getOHLCV(symbol: string, limit: number): OHLCVBar[] {
  return getDb()
    .prepare<[string, number], OHLCVBar>(`
      SELECT symbol, date, open, high, low, close, volume
      FROM ohlcv WHERE symbol = ?
      ORDER BY date DESC LIMIT ?
    `)
    .all(symbol, limit)
    .reverse(); // 古い→新しい順
}

export function getOHLCVByDateRange(
  symbol: string,
  startDate: string,
  endDate: string,
): OHLCVBar[] {
  return getDb()
    .prepare<[string, string, string], OHLCVBar>(`
      SELECT symbol, date, open, high, low, close, volume
      FROM ohlcv WHERE symbol = ? AND date >= ? AND date <= ?
      ORDER BY date ASC
    `)
    .all(symbol, startDate, endDate);
}

export function getLatestOHLCVDate(symbol: string): string | null {
  const row = getDb()
    .prepare<[string], { date: string }>('SELECT date FROM ohlcv WHERE symbol = ? ORDER BY date DESC LIMIT 1')
    .get(symbol);
  return row?.date ?? null;
}

export function getAllSymbolsInDB(): string[] {
  return getDb()
    .prepare<[], { symbol: string }>('SELECT DISTINCT symbol FROM ohlcv')
    .all()
    .map((r) => r.symbol);
}

// ─── Signal ───────────────────────────────────────────────────────────────────

export function insertSignal(signal: Signal): void {
  getDb().prepare(`
    INSERT INTO signals (symbol, date, type, price, reason)
    VALUES (@symbol, @date, @type, @price, @reason)
  `).run(signal);
}

export function getSignalsByDate(date: string): Signal[] {
  return getDb()
    .prepare<[string], Signal>('SELECT * FROM signals WHERE date = ? ORDER BY id ASC')
    .all(date);
}

// ─── Order ────────────────────────────────────────────────────────────────────

export function insertOrder(order: Order): number {
  const result = getDb().prepare(`
    INSERT INTO orders (symbol, date, type, quantity, price, status, reason)
    VALUES (@symbol, @date, @type, @quantity, @price, @status, @reason)
  `).run(order);
  return result.lastInsertRowid as number;
}

export function getOrdersByDate(date: string): Order[] {
  return getDb()
    .prepare<[string], Order>('SELECT * FROM orders WHERE date = ? ORDER BY id ASC')
    .all(date);
}

export function getAllOrders(): Order[] {
  return getDb()
    .prepare<[], Order>('SELECT * FROM orders ORDER BY id ASC')
    .all();
}

// ─── Position ─────────────────────────────────────────────────────────────────

interface PositionRow {
  id: number;
  symbol: string;
  quantity: number;
  entry_price: number;
  entry_date: string;
  highest_price: number;
  stop_loss: number;
  take_profit: number;
}

function rowToPosition(r: PositionRow): Position {
  return {
    id:           r.id,
    symbol:       r.symbol,
    quantity:     r.quantity,
    entryPrice:   r.entry_price,
    entryDate:    r.entry_date,
    highestPrice: r.highest_price,
    stopLoss:     r.stop_loss,
    takeProfit:   r.take_profit,
  };
}

export function insertPosition(pos: Position): void {
  getDb().prepare(`
    INSERT INTO positions (symbol, quantity, entry_price, entry_date, highest_price, stop_loss, take_profit)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    pos.symbol, pos.quantity, pos.entryPrice, pos.entryDate,
    pos.highestPrice, pos.stopLoss, pos.takeProfit,
  );
}

export function updatePositionHighestPrice(symbol: string, highestPrice: number): void {
  getDb().prepare(`
    UPDATE positions SET highest_price = ? WHERE symbol = ?
  `).run(highestPrice, symbol);
}

export function deletePosition(symbol: string): void {
  getDb().prepare('DELETE FROM positions WHERE symbol = ?').run(symbol);
}

export function getOpenPositions(): Position[] {
  return getDb()
    .prepare<[], PositionRow>('SELECT * FROM positions ORDER BY id ASC')
    .all()
    .map(rowToPosition);
}

export function getPosition(symbol: string): Position | null {
  const row = getDb()
    .prepare<[string], PositionRow>('SELECT * FROM positions WHERE symbol = ?')
    .get(symbol);
  return row ? rowToPosition(row) : null;
}

// ─── Trade ────────────────────────────────────────────────────────────────────

interface TradeRow {
  id: number;
  symbol: string;
  entry_date: string;
  exit_date: string;
  entry_price: number;
  exit_price: number;
  quantity: number;
  pnl: number;
  pnl_pct: number;
  reason: string;
}

function rowToTrade(r: TradeRow): Trade {
  return {
    id:         r.id,
    symbol:     r.symbol,
    entryDate:  r.entry_date,
    exitDate:   r.exit_date,
    entryPrice: r.entry_price,
    exitPrice:  r.exit_price,
    quantity:   r.quantity,
    pnl:        r.pnl,
    pnlPct:     r.pnl_pct,
    reason:     r.reason as Trade['reason'],
  };
}

export function insertTrade(trade: Trade): void {
  getDb().prepare(`
    INSERT INTO trades (symbol, entry_date, exit_date, entry_price, exit_price, quantity, pnl, pnl_pct, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    trade.symbol, trade.entryDate, trade.exitDate,
    trade.entryPrice, trade.exitPrice, trade.quantity,
    trade.pnl, trade.pnlPct, trade.reason,
  );
}

export function getTradesByDate(date: string): Trade[] {
  return getDb()
    .prepare<[string], TradeRow>('SELECT * FROM trades WHERE exit_date = ? ORDER BY id ASC')
    .all(date)
    .map(rowToTrade);
}

export function getAllTrades(): Trade[] {
  return getDb()
    .prepare<[], TradeRow>('SELECT * FROM trades ORDER BY id ASC')
    .all()
    .map(rowToTrade);
}

// ─── Daily Risk ───────────────────────────────────────────────────────────────

interface DailyRiskRow {
  date: string;
  starting_equity: number;
  current_equity: number;
  daily_pnl: number;
  daily_pnl_pct: number;
  trade_count: number;
}

function rowToDailyRisk(r: DailyRiskRow): DailyRisk {
  return {
    date:           r.date,
    startingEquity: r.starting_equity,
    currentEquity:  r.current_equity,
    dailyPnl:       r.daily_pnl,
    dailyPnlPct:    r.daily_pnl_pct,
    tradeCount:     r.trade_count,
  };
}

export function upsertDailyRisk(risk: DailyRisk): void {
  getDb().prepare(`
    INSERT INTO daily_risk (date, starting_equity, current_equity, daily_pnl, daily_pnl_pct, trade_count)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      current_equity=excluded.current_equity,
      daily_pnl=excluded.daily_pnl,
      daily_pnl_pct=excluded.daily_pnl_pct,
      trade_count=excluded.trade_count
  `).run(
    risk.date, risk.startingEquity, risk.currentEquity,
    risk.dailyPnl, risk.dailyPnlPct, risk.tradeCount,
  );
}

export function getDailyRisk(date: string): DailyRisk | null {
  const row = getDb()
    .prepare<[string], DailyRiskRow>('SELECT * FROM daily_risk WHERE date = ?')
    .get(date);
  return row ? rowToDailyRisk(row) : null;
}

export function getDailyRiskHistory(limit = 30): DailyRisk[] {
  return getDb()
    .prepare<[number], DailyRiskRow>('SELECT * FROM daily_risk ORDER BY date DESC LIMIT ?')
    .all(limit)
    .map(rowToDailyRisk)
    .reverse();
}

/** 現在の仮想資産 = 初期資金 + 全損益 */
export function calcCurrentEquity(initialEquity: number): number {
  const result = getDb()
    .prepare<[], { total_pnl: number | null }>('SELECT SUM(pnl) AS total_pnl FROM trades')
    .get();
  return initialEquity + (result?.total_pnl ?? 0);
}
