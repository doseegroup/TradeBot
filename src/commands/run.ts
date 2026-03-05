/**
 * npm run run
 * 戦略シグナルを評価し、紙トレードを実行する
 * 実行後にLINE通知を送信する
 */
import 'dotenv/config';
import { runMigrations } from '../db/schema.js';
import { runTradingCycle } from '../trading/engine.js';
import { getPortfolioSummary } from '../risk/manager.js';
import { notifyTradeSummary, notifyKillSwitch } from '../notifications/line.js';
import { logger } from '../utils/logger.js';
import { isKillSwitchActive } from '../utils/killswitch.js';
import { toDateString } from '../providers/base.js';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const watchlist = require('../../config/watchlist.json') as { symbols: string[] };

async function main(): Promise<void> {
  logger.info('=== トレーディングサイクル開始 ===');
  runMigrations();

  if (isKillSwitchActive()) {
    const msg = 'Kill Switch が有効です。取引を停止しています。';
    logger.error(msg);
    await notifyKillSwitch(msg);
    process.exit(1);
  }

  const date    = toDateString(new Date());
  const symbols: string[] = watchlist.symbols;

  try {
    const { entered, exited, signals } = await runTradingCycle(symbols, date);

    logger.info(`エントリー: ${entered.length > 0 ? entered.join(', ') : 'なし'}`);
    logger.info(`イグジット: ${exited.length  > 0 ? exited.join(', ')  : 'なし'}`);
    logger.info(`シグナル:   ${signals.length > 0 ? signals.join(' | ') : 'なし'}`);

    const summary = getPortfolioSummary();

    await notifyTradeSummary({
      date,
      entered,
      exited,
      todayPnl:      summary.todayPnl,
      todayPnlPct:   summary.todayPnlPct,
      currentEquity: summary.currentEquity,
      openPositions: summary.openPositions,
    });

    logger.info('=== トレーディングサイクル完了 ===');
  } catch (err) {
    logger.error('トレーディングサイクル エラー:', err);

    if (isKillSwitchActive()) {
      await notifyKillSwitch(String(err));
    }

    process.exit(1);
  }
}

main().catch((err) => {
  logger.error('runコマンド 致命的エラー:', err);
  process.exit(1);
});
