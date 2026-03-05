/**
 * npm run report [YYYY-MM-DD]
 * 日次レポートを生成して reports/YYYY-MM-DD.md + daily_reports テーブルに保存し LINE 通知
 */
import 'dotenv/config';
import { runMigrations } from '../db/migrations';
import { setLogDb } from '../utils/logger';
import { getDb } from '../db/client';
import { logger } from '../utils/logger';
import { generateReport } from '../report/generator';
import { notifyReport } from '../notify/line';
import { todayString } from '../utils/date';

async function main(): Promise<void> {
  runMigrations();
  setLogDb(getDb());

  const date = process.argv[2] ?? todayString();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    logger.error(`日付フォーマット不正: ${date} (期待: YYYY-MM-DD)`);
    process.exit(1);
  }

  logger.info(`=== レポート生成: ${date} ===`);

  try {
    const content = await generateReport(date);
    await notifyReport(date, content);
    logger.info(`=== レポート完了: reports/${date}.md ===`);
  } catch (err) {
    logger.error('レポート生成エラー:', err);
    process.exit(1);
  }
}

main().catch((err) => {
  logger.error('report 致命的エラー:', err);
  process.exit(1);
});
