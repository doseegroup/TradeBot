/**
 * DB スキーマ定義 & マイグレーション（v2）
 */
import { getDb } from './client';
import { logger } from '../utils/logger';

export function runMigrations(): void {
  const db = getDb();

  db.exec(`
    -- ─── OHLCV 価格データ ────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS prices (
      symbol TEXT NOT NULL,
      date   TEXT NOT NULL,
      open   REAL NOT NULL,
      high   REAL NOT NULL,
      low    REAL NOT NULL,
      close  REAL NOT NULL,
      volume REAL NOT NULL,
      PRIMARY KEY (symbol, date)
    );

    -- ─── シグナル ─────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS signals (
      id        TEXT PRIMARY KEY,
      date      TEXT NOT NULL,
      symbol    TEXT NOT NULL,
      action    TEXT NOT NULL,   -- BUY | SELL
      reason    TEXT,
      meta_json TEXT
    );

    -- ─── 注文（T+1 約定待ち or 約定済み）────────────────────────────────────
    CREATE TABLE IF NOT EXISTS orders (
      id     TEXT PRIMARY KEY,
      date   TEXT NOT NULL,   -- 注文日
      symbol TEXT NOT NULL,
      side   TEXT NOT NULL,   -- BUY | SELL
      qty    REAL NOT NULL,
      price  REAL NOT NULL,   -- 想定価格（参考）
      status TEXT NOT NULL    -- PENDING | FILLED | CANCELLED
    );

    -- ─── 約定明細 ─────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS fills (
      id       TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      date     TEXT NOT NULL,
      price    REAL NOT NULL,
      qty      REAL NOT NULL
    );

    -- ─── 保有ポジション ───────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS positions (
      symbol        TEXT PRIMARY KEY,
      qty           REAL NOT NULL,
      avg_price     REAL NOT NULL,
      realized_pnl  REAL NOT NULL DEFAULT 0,
      updated_at    TEXT NOT NULL,
      entry_date    TEXT,
      entry_price   REAL,
      highest_price REAL,
      stop_loss     REAL,
      take_profit   REAL
    );

    -- ─── 資産推移 ─────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS equity (
      date     TEXT PRIMARY KEY,
      equity   REAL NOT NULL,
      drawdown REAL NOT NULL DEFAULT 0
    );

    -- ─── 日次レポート ─────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS daily_reports (
      date       TEXT PRIMARY KEY,
      content    TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- ─── システム状態（Kill Switch, クールダウン など）────────────────────────
    CREATE TABLE IF NOT EXISTS system_state (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ─── ログ（console + DB 二重ロギング）────────────────────────────────────
    CREATE TABLE IF NOT EXISTS logs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      level      TEXT NOT NULL,
      message    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  logger.info('DB マイグレーション完了 (v2)');
}
