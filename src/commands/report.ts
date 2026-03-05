/**
 * npm run report [YYYY-MM-DD]
 * 日次レポートを生成して reports/YYYY-MM-DD.md に保存する
 * 引数なしの場合は今日の日付を使用
 */
import 'dotenv/config';
import { runMigrations } from '../db/schema.js';
import { generateDailyReport } from '../reports/generator.js';
import { sendLineMessage } from '../notifications/line.js';
import { logger } from '../utils/logger.js';
import { toDateString } from '../providers/base.js';

async function main(): Promise<void> {
  runMigrations();

  const date = process.argv[2] ?? toDateString(new Date());

  // YYYY-MM-DD バリデーション
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    logger.error(`日付フォーマットが不正です: ${date} (期待: YYYY-MM-DD)`);
    process.exit(1);
  }

  logger.info(`=== 日次レポート生成: ${date} ===`);

  try {
    const report = await generateDailyReport(date);

    // レポートの最初の2000文字を LINE に通知
    const preview = report.slice(0, 2000);
    await sendLineMessage(`📄 日次レポート (${date})\n\n${preview}${report.length > 2000 ? '\n...(続きは reports/ フォルダを確認)' : ''}`);

    logger.info(`=== レポート生成完了: reports/${date}.md ===`);
  } catch (err) {
    logger.error('レポート生成エラー:', err);
    process.exit(1);
  }
}

main().catch((err) => {
  logger.error('reportコマンド 致命的エラー:', err);
  process.exit(1);
});
