/**
 * DB スキーマ定義 & マイグレーション
 * 単独実行: tsx src/db/schema.ts
 */
import 'dotenv/config';
import { getDb } from './index.js';
import { logger } from '../utils/logger.js';

export function runMigrations(): void {
  const db = getDb();

  db.exec(`
    -- ─── OHLCV ─────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS ohlcv (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol     TEXT    NOT NULL,
      date       TEXT    NOT NULL,   -- YYYY-MM-DD
      open       REAL    NOT NULL,
      high       REAL    NOT NULL,
      low        REAL    NOT NULL,
      close      REAL    NOT NULL,
      volume     INTEGER NOT NULL,
      created_at TEXT    DEFAULT (datetime('now')),
      UNIQUE(symbol, date)
    );

    -- ─── シグナル ───────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS signals (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol     TEXT NOT NULL,
      date       TEXT NOT NULL,
      type       TEXT NOT NULL,   -- BUY | SELL
      price      REAL NOT NULL,
      reason     TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ─── 注文 (仮約定) ──────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS orders (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol     TEXT NOT NULL,
      date       TEXT NOT NULL,
      type       TEXT NOT NULL,   -- BUY | SELL
      quantity   REAL NOT NULL,
      price      REAL NOT NULL,
      status     TEXT NOT NULL DEFAULT 'FILLED',  -- PENDING | FILLED | CANCELLED
      reason     TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ─── ポジション (保有中) ─────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS positions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol        TEXT NOT NULL UNIQUE,
      quantity      REAL NOT NULL,
      entry_price   REAL NOT NULL,
      entry_date    TEXT NOT NULL,
      highest_price REAL NOT NULL,  -- トレイリングストップ用
      stop_loss     REAL NOT NULL,
      take_profit   REAL NOT NULL,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    -- ─── 取引履歴 ───────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS trades (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol      TEXT NOT NULL,
      entry_date  TEXT NOT NULL,
      exit_date   TEXT NOT NULL,
      entry_price REAL NOT NULL,
      exit_price  REAL NOT NULL,
      quantity    REAL NOT NULL,
      pnl         REAL NOT NULL,
      pnl_pct     REAL NOT NULL,
      reason      TEXT NOT NULL,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    -- ─── 日次リスク ─────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS daily_risk (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      date             TEXT NOT NULL UNIQUE,
      starting_equity  REAL NOT NULL,
      current_equity   REAL NOT NULL,
      daily_pnl        REAL NOT NULL DEFAULT 0,
      daily_pnl_pct    REAL NOT NULL DEFAULT 0,
      trade_count      INTEGER NOT NULL DEFAULT 0,
      created_at       TEXT DEFAULT (datetime('now'))
    );

    -- ─── Kill Switch ─────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS kill_switch (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      active       INTEGER NOT NULL DEFAULT 0,
      reason       TEXT,
      activated_at TEXT,
      created_at   TEXT DEFAULT (datetime('now'))
    );

    -- ─── システム状態 ────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS system_state (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  logger.info('DB マイグレーション完了');
}

// 単独実行
if (process.argv[1]?.endsWith('schema.ts') || process.argv[1]?.endsWith('schema.js')) {
  runMigrations();
  logger.info('DB 初期化完了');
  process.exit(0);
}
