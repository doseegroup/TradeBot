import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  const dbPath = path.resolve(config.dbPath);
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  logger.debug(`DB 接続: ${dbPath}`);

  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
    logger.debug('DB 接続クローズ');
  }
}

// ─── ヘルパー関数 ─────────────────────────────────────────────────────────────

/** システム状態を保存 */
export function setState(key: string, value: string): void {
  getDb().prepare(`
    INSERT INTO system_state (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
  `).run(key, value);
}

/** システム状態を取得 */
export function getState(key: string): string | null {
  const row = getDb()
    .prepare<[string], { value: string }>('SELECT value FROM system_state WHERE key = ?')
    .get(key);
  return row?.value ?? null;
}
