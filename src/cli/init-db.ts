/**
 * npm run init-db
 * SQLite DB の初期化（テーブル作成・マイグレーション）
 */
import 'dotenv/config';
import { runMigrations } from '../db/migrations';
import { setLogDb } from '../utils/logger';
import { getDb } from '../db/client';
import { logger } from '../utils/logger';

function main(): void {
  runMigrations();
  setLogDb(getDb());
  logger.info('=== DB 初期化完了 ===');
}

main();
