/**
 * npm run fetch
 * ウォッチリストの全銘柄の最新 OHLCV データを取得して DB に保存する
 */
import 'dotenv/config';
import { runMigrations } from '../db/schema.js';
import { createDataProvider } from '../providers/factory.js';
import { upsertOHLCV, getLatestOHLCVDate } from '../db/queries.js';
import { logger } from '../utils/logger.js';
import { recordError, resetErrorCount, isKillSwitchActive } from '../utils/killswitch.js';
import { config } from '../config.js';
import { fetchWithRetry, toDateString, daysAgo } from '../providers/base.js';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const watchlist = require('../../config/watchlist.json') as { symbols: string[] };

async function main(): Promise<void> {
  logger.info('=== データフェッチ開始 ===');
  runMigrations();

  if (isKillSwitchActive()) {
    logger.error('Kill Switch が有効です。フェッチを中止します。');
    process.exit(1);
  }

  const provider  = createDataProvider();
  const today     = toDateString(new Date());
  const symbols: string[] = watchlist.symbols;

  let successCount = 0;
  let errorCount   = 0;

  for (const symbol of symbols) {
    try {
      // 最後に保存されている日付の翌日からフェッチ
      const latestDate = getLatestOHLCVDate(symbol);
      const startDate  = latestDate
        ? (() => {
            const d = new Date(latestDate);
            d.setDate(d.getDate() + 1);
            return toDateString(d);
          })()
        : daysAgo(config.lookbackDays + 10); // 初回は十分な過去データを取得

      if (startDate > today) {
        logger.info(`${symbol}: 最新データ取得済み (${latestDate})`);
        successCount++;
        continue;
      }

      const bars = await fetchWithRetry(
        () => provider.fetchDaily(symbol, startDate, today),
        3,
        2000,
      );

      if (bars.length === 0) {
        logger.warn(`${symbol}: データが空でした (${startDate}〜${today})`);
        continue;
      }

      upsertOHLCV(bars);
      logger.info(`${symbol}: ${bars.length} 件保存 (${bars[0]?.date}〜${bars[bars.length - 1]?.date})`);
      resetErrorCount();
      successCount++;

      // Yahoo Finance のレート制限を避けるための待機
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      logger.error(`${symbol} フェッチエラー:`, err);
      recordError(config.maxConsecutiveErrors);
      errorCount++;

      if (isKillSwitchActive()) {
        logger.error('Kill Switch 発動のためフェッチを中止します');
        break;
      }
    }
  }

  logger.info(`=== データフェッチ完了: 成功 ${successCount}/${symbols.length}, エラー ${errorCount} ===`);
}

main().catch((err) => {
  logger.error('フェッチコマンド 致命的エラー:', err);
  process.exit(1);
});
