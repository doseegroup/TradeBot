/**
 * npm run backfill [days]
 * 指定日数分の過去データを全銘柄に対して取得してDBに保存する
 * デフォルト: 365日
 * 例: npm run backfill 90
 */
import 'dotenv/config';
import { runMigrations } from '../db/schema.js';
import { createDataProvider } from '../providers/factory.js';
import { upsertOHLCV } from '../db/queries.js';
import { fetchWithRetry, toDateString } from '../providers/base.js';
import { logger } from '../utils/logger.js';
import { recordError, resetErrorCount, isKillSwitchActive } from '../utils/killswitch.js';
import { config } from '../config.js';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const watchlist = require('../../config/watchlist.json') as { symbols: string[] };

async function main(): Promise<void> {
  runMigrations();

  const daysArg = parseInt(process.argv[2] ?? '365', 10);
  if (isNaN(daysArg) || daysArg <= 0) {
    logger.error('days は正の整数を指定してください');
    process.exit(1);
  }

  const endDate   = toDateString(new Date());
  const startDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() - daysArg);
    return toDateString(d);
  })();

  const symbols: string[] = watchlist.symbols;
  logger.info(`=== バックフィル開始: ${startDate}〜${endDate} (${daysArg}日間, ${symbols.length}銘柄) ===`);

  const provider = createDataProvider();
  let successCount = 0;
  let errorCount   = 0;

  for (const symbol of symbols) {
    if (isKillSwitchActive()) {
      logger.error('Kill Switch 発動のためバックフィルを中止します');
      break;
    }

    try {
      const bars = await fetchWithRetry(
        () => provider.fetchDaily(symbol, startDate, endDate),
        3,
        3000,
      );

      if (bars.length === 0) {
        logger.warn(`${symbol}: データが空でした`);
        continue;
      }

      upsertOHLCV(bars);
      logger.info(`${symbol}: ${bars.length} 件保存 (${bars[0]?.date}〜${bars[bars.length - 1]?.date})`);
      resetErrorCount();
      successCount++;

      // レート制限回避
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      logger.error(`${symbol} バックフィルエラー:`, err);
      recordError(config.maxConsecutiveErrors);
      errorCount++;
    }
  }

  logger.info(`=== バックフィル完了: 成功 ${successCount}/${symbols.length}, エラー ${errorCount} ===`);
}

main().catch((err) => {
  logger.error('backfillコマンド 致命的エラー:', err);
  process.exit(1);
});
