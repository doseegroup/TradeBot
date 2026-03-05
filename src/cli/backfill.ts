/**
 * npm run backfill -- --symbols AAPL,MSFT,QQQ --days 365
 * 指定銘柄の過去データを一括取得して prices テーブルに保存する
 *
 * オプション:
 *   --symbols AAPL,MSFT   対象銘柄（カンマ区切り）。省略時はウォッチリスト全銘柄
 *   --days 365            取得日数（デフォルト 365）
 */
import 'dotenv/config';
import { runMigrations } from '../db/migrations';
import { setLogDb } from '../utils/logger';
import { getDb } from '../db/client';
import { logger } from '../utils/logger';
import { createProvider } from '../data/factory';
import { withRetry } from '../data/types';
import { upsertPrices } from '../db/prices';
import { todayString, daysAgo } from '../utils/date';
import { isKillSwitchActive } from '../db/system';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const watchlist = require('../../config/watchlist.json') as { symbols: string[] };

function parseArgs(): { symbols: string[]; days: number } {
  const argv = process.argv.slice(2);
  let symbols: string[] = [];
  let days = 365;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--symbols' && argv[i + 1]) {
      symbols = argv[i + 1]!.split(',').map((s) => s.trim().toUpperCase());
      i++;
    } else if (argv[i] === '--days' && argv[i + 1]) {
      const n = parseInt(argv[i + 1]!, 10);
      if (!isNaN(n) && n > 0) days = n;
      i++;
    }
  }

  if (symbols.length === 0) symbols = watchlist.symbols;
  return { symbols, days };
}

async function main(): Promise<void> {
  runMigrations();
  setLogDb(getDb());

  const { symbols, days } = parseArgs();
  const today     = todayString();
  const startDate = daysAgo(days);
  const provider  = createProvider();

  logger.info(`=== バックフィル開始: ${startDate}〜${today} (${days}日間, ${symbols.length}銘柄) ===`);

  let ok = 0, ng = 0;

  for (const symbol of symbols) {
    if (isKillSwitchActive()) {
      logger.error('Kill Switch 発動 → バックフィル中止');
      break;
    }

    try {
      const bars = await withRetry(
        () => provider.fetchDaily(symbol, startDate, today),
        3,
        3000,
      );

      if (bars.length === 0) {
        logger.warn(`${symbol}: データ空`);
        ok++;
        continue;
      }

      upsertPrices(bars);
      logger.info(`${symbol}: ${bars.length} 件保存 (${bars[0]?.date}〜${bars[bars.length - 1]?.date})`);
      ok++;
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      logger.error(`${symbol} バックフィルエラー:`, err);
      ng++;
    }
  }

  logger.info(`=== バックフィル完了: OK ${ok}/${symbols.length}, NG ${ng} ===`);
}

main().catch((err) => {
  logger.error('backfill 致命的エラー:', err);
  process.exit(1);
});
