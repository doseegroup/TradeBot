/**
 * ロガー（console + ファイル + SQLite の3方向に出力）
 * DB ロギングは setLogDb() を呼んでから有効になる（循環依存を回避）
 */
import { createLogger, format, transports } from 'winston';
import Transport from 'winston-transport';
import path from 'path';
import fs from 'fs';
import type Database from 'better-sqlite3';

const LOG_DIR = path.join(process.cwd(), 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// ─── DB への遅延ロギング ──────────────────────────────────────────────────────
let _db: Database.Database | null = null;

export function setLogDb(db: Database.Database): void {
  _db = db;
}

// ─── カスタム Winston Transport ───────────────────────────────────────────────
class SqliteTransport extends Transport {
  log(info: { level: string; message: string }, callback: () => void): void {
    if (_db) {
      try {
        _db.prepare(
          "INSERT INTO logs (level, message, created_at) VALUES (?, ?, datetime('now'))",
        ).run(info.level, String(info.message));
      } catch {
        // DB 書き込み失敗はサイレントに無視
      }
    }
    callback();
  }
}

// ─── ロガー本体 ───────────────────────────────────────────────────────────────
const { combine, timestamp, colorize, printf, errors } = format;

const logFmt = printf(({ level, message, timestamp: ts, stack }) => {
  return `${ts} [${level}]: ${stack ?? message}`;
});

export const logger = createLogger({
  level: process.env['LOG_LEVEL'] ?? 'info',
  format: combine(errors({ stack: true }), timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), logFmt),
  transports: [
    new transports.Console({
      format: combine(
        colorize(),
        errors({ stack: true }),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        logFmt,
      ),
    }),
    new transports.File({ filename: path.join(LOG_DIR, 'error.log'), level: 'error' }),
    new transports.File({ filename: path.join(LOG_DIR, 'combined.log') }),
    new SqliteTransport(),
  ],
});
