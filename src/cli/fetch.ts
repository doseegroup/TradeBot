/**
 * npm run fetch
 * ウォッチリストの全銘柄（QQQ含む）の最新 OHLCV を取得して prices テーブルに保存
 */
import 'dotenv/config';
import { runMigrations } from '../db/migrations';
import { setLogDb } from '../utils/logger';
import { getDb } from '../db/client';
import { logger } from '../utils/logger';
import { createProvider } from '../data/factory';
import { withRetry } from '../data/types';
import { upsertPrices, latestDate } from '../db/prices';
import { CONFIG } from '../config/index';
import { todayString, daysAgo } from '../utils/date';
import { isKillSwitchActive } from '../db/system';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const watchlist = require('../../config/watchlist.json') as { symbols: string[] };

async function main(): Promise<void> {
  runMigrations();
  setLogDb(getDb());
  logger.info('=== データフェッチ開始 ===');

  if (isKillSwitchActive()) {
    logger.error('Kill Switch が有効です。フェッチを中止します。');
    process.exit(1);
  }

  const provider = createProvider();
  const today    = todayString();
  const symbols  = watchlist.symbols;

  let ok = 0, ng = 0;

  for (const symbol of symbols) {
    try {
      // 最終取得日の翌日から取得
      const lastDate  = latestDate(symbol);
      const startDate = lastDate
        ? (() => {
            const d = new Date(lastDate + 'T12:00:00Z');
            d.setUTCDate(d.getUTCDate() + 1);
            return d.toISOString().slice(0, 10);
          })()
        : daysAgo(CONFIG.LOOKBACK + CONFIG.SMA_SLOW + 10); // SMA200 計算のため余裕を持って取得

      if (startDate > today) {
        logger.info(`${symbol}: 最新データ取得済み (${lastDate})`);
        ok++;
        continue;
      }

      const bars = await withRetry(() => provider.fetchDaily(symbol, startDate, today), 3, 2000);
      if (bars.length === 0) {
        logger.warn(`${symbol}: データ空 (${startDate}〜${today})`);
        ok++;
        continue;
      }

      upsertPrices(bars);
      logger.info(`${symbol}: ${bars.length} 件保存 (${bars[0]?.date}〜${bars[bars.length - 1]?.date})`);
      ok++;

      // レート制限回避
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      logger.error(`${symbol} フェッチエラー:`, err);
      ng++;
    }
  }

  logger.info(`=== フェッチ完了: OK ${ok}/${symbols.length}, NG ${ng} ===`);
}

main().catch((err) => {
  logger.error('fetch 致命的エラー:', err);
  process.exit(1);
});
