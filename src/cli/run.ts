/**
 * npm run run
 * フル取引サイクル:
 *   fetch → T+1 約定 → イグジット評価 → レジーム/流動性/決算フィルター
 *   → ブレイクアウト判定 → 新規 PENDING オーダー → 資産更新 → LINE 通知
 */
import 'dotenv/config';
import path from 'path';
import { runMigrations } from '../db/migrations';
import { setLogDb } from '../utils/logger';
import { getDb } from '../db/client';
import { logger } from '../utils/logger';
import { CONFIG } from '../config/index';

// Data
import { createProvider } from '../data/factory';
import { withRetry } from '../data/types';
import { upsertPrices, latestDate, getPriceBars } from '../db/prices';
import { todayString, daysAgo } from '../utils/date';

// Filters
import { liquidityFilter, marketRegimeFilter, earningsFilter, loadEarningsMap } from '../strategy/filters';
// Breakout
import { evaluateBreakout, calcPositionSize } from '../strategy/breakout';
// Risk
import { checkKillSwitch, checkCooldown, checkDailyLoss, recordDayStart, getCurrentEquity, canEnter } from '../risk/engine';
// Paper execution
import { fillPendingOrders, checkAndExit, createBuyOrder, estimateCurrentEquity } from '../paper/executor';
// DB
import { insertSignal } from '../db/signals';
import { upsertEquity, getEquityHistory } from '../db/equity';
import { getAllPositions } from '../db/positions';
// Notify
import {
  notifySignal, notifyFill, notifyDailySummary, notifyKillSwitch,
} from '../notify/line';
import { maxDrawdown } from '../utils/math';
import { isKillSwitchActive } from '../db/system';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const watchlist = require('../../config/watchlist.json') as { symbols: string[] };

async function main(): Promise<void> {
  runMigrations();
  setLogDb(getDb());
  logger.info('=== トレーディングサイクル開始 ===');

  // ─── Kill Switch チェック ─────────────────────────────────────────────────
  const ks = checkKillSwitch();
  if (ks.blocked) {
    logger.error(ks.reason);
    await notifyKillSwitch(ks.reason ?? '');
    process.exit(1);
  }

  const today   = todayString();
  const symbols = watchlist.symbols;
  const provider = createProvider();

  // ─── Step 1: データフェッチ ───────────────────────────────────────────────
  logger.info(`[Step 1] データフェッチ (${symbols.length} 銘柄)`);
  for (const symbol of symbols) {
    try {
      const lastDate  = latestDate(symbol);
      const startDate = lastDate
        ? (() => {
            const d = new Date(lastDate + 'T12:00:00Z');
            d.setUTCDate(d.getUTCDate() + 1);
            return d.toISOString().slice(0, 10);
          })()
        : daysAgo(CONFIG.SMA_SLOW + CONFIG.LOOKBACK + 10);

      if (startDate > today) { continue; }

      const bars = await withRetry(() => provider.fetchDaily(symbol, startDate, today), 3, 2000);
      if (bars.length > 0) {
        upsertPrices(bars);
        logger.debug(`${symbol}: ${bars.length} 件保存`);
      }
      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      logger.error(`${symbol} フェッチエラー:`, err);
    }
  }

  // ─── 日次開始資産記録 ─────────────────────────────────────────────────────
  recordDayStart(getCurrentEquity());

  // ─── Step 2: T+1 PENDING 注文の約定処理 ──────────────────────────────────
  logger.info('[Step 2] PENDING 注文の約定処理');
  const fillResults = await fillPendingOrders(today);
  for (const fill of fillResults) {
    if (fill.side === 'BUY') {
      await notifyFill(fill.symbol, fill.side, fill.qty, fill.fillPrice);
    }
  }

  // ─── Step 3: イグジット評価 ───────────────────────────────────────────────
  logger.info('[Step 3] イグジット評価');
  const exitResults = await checkAndExit(today);
  const exitedSymbols: string[] = [];
  for (const exit of exitResults) {
    await notifyFill(exit.symbol, 'SELL', exit.qty, exit.fillPrice, exit.pnl);
    exitedSymbols.push(exit.symbol);
  }

  // ─── Step 4: Kill Switch / クールダウン 再確認 ───────────────────────────
  if (isKillSwitchActive()) {
    logger.warn('Kill Switch 発動 → 新規エントリーをスキップ');
    await finalizeAndNotify(today, [], exitedSymbols, []);
    return;
  }
  const cd = checkCooldown();
  if (cd.blocked) {
    logger.warn(`クールダウン中 → 新規エントリースキップ: ${cd.reason}`);
    await finalizeAndNotify(today, [], exitedSymbols, []);
    return;
  }

  // ─── Step 5: 市場レジームフィルター（QQQ）───────────────────────────────
  logger.info('[Step 5] 市場レジームフィルター');
  const qqqBars = getPriceBars(CONFIG.BENCHMARK, CONFIG.SMA_SLOW + 10);
  const regime  = marketRegimeFilter(qqqBars);
  logger.info(`[Regime] ${regime.passed ? 'OK' : 'NG'}: ${regime.reason}`);

  if (!regime.passed) {
    logger.info('レジームフィルター不通過 → 新規エントリーをスキップ');
    await finalizeAndNotify(today, [], exitedSymbols, []);
    return;
  }

  // ─── Step 6〜8: 各銘柄のシグナル評価 ─────────────────────────────────────
  logger.info('[Step 6-8] シグナル評価');
  const earningsMap = loadEarningsMap(path.join(process.cwd(), 'config', 'earnings.csv'));
  const enteredSymbols: string[] = [];
  const signalSymbols:  string[] = [];

  const tradingSymbols = symbols.filter((s) => s !== CONFIG.BENCHMARK);

  for (const symbol of tradingSymbols) {
    try {
      // 流動性フィルター
      const bars = getPriceBars(symbol, CONFIG.LOOKBACK + 5);
      const liq  = liquidityFilter(bars);
      if (!liq.passed) {
        logger.debug(`[LiqFilter] ${symbol}: ${liq.reason}`);
        continue;
      }

      // 決算フィルター
      if (!earningsFilter(symbol, today, earningsMap)) continue;

      // ポジション上限・重複チェック
      const canEnterCheck = canEnter(symbol);
      if (!canEnterCheck.allowed) {
        logger.debug(`[RiskCheck] ${symbol}: ${canEnterCheck.reason}`);
        continue;
      }

      // ブレイクアウト評価
      const signal = evaluateBreakout(bars);
      if (!signal) continue;

      signalSymbols.push(symbol);

      // シグナル記録
      insertSignal({
        date:      signal.date,
        symbol:    signal.symbol,
        action:    'BUY',
        reason:    signal.reason,
        meta_json: JSON.stringify(signal.meta),
      });

      // 資産チェック後にポジションサイズ決定
      const equity  = getCurrentEquity();
      const qty     = calcPositionSize(equity, signal.meta.close);
      if (qty === 0) {
        logger.warn(`${symbol}: ポジションサイズ 0 → スキップ`);
        continue;
      }

      // PENDING オーダー作成（翌日約定）
      createBuyOrder(symbol, today, signal.meta.close, qty);
      enteredSymbols.push(symbol);

      await notifySignal(symbol, today, signal.reason, signal.meta.close);
    } catch (err) {
      logger.error(`${symbol} シグナル評価エラー:`, err);
    }
  }

  await finalizeAndNotify(today, enteredSymbols, exitedSymbols, signalSymbols);
}

async function finalizeAndNotify(
  today: string,
  entered: string[],
  exited: string[],
  signals: string[],
): Promise<void> {
  // ─── Step 9: equity テーブル更新 ─────────────────────────────────────────
  const equity   = getCurrentEquity();
  const history  = getEquityHistory(365);
  const equities = history.map((e) => e.equity);
  const dd       = maxDrawdown([...equities, equity]);

  upsertEquity({ date: today, equity, drawdown: dd });
  logger.info(`資産: $${equity.toFixed(2)} | DD: ${(dd * 100).toFixed(2)}%`);

  // ─── Step 10: LINE 通知 ───────────────────────────────────────────────────
  const positions  = getAllPositions();
  const prevEquity = history[history.length - 1]?.equity ?? CONFIG.INITIAL_EQUITY;
  const dailyPnl   = equity - prevEquity;

  await notifyDailySummary({
    date: today,
    equity,
    dailyPnl,
    openPositions: positions.length,
    filled:  entered,
    exited,
    signals,
  });

  logger.info(
    `=== サイクル完了: シグナル ${signals.length} | PENDING ${entered.length} | クローズ ${exited.length} ===`,
  );
}

main().catch(async (err) => {
  logger.error('run 致命的エラー:', err);
  await notifyKillSwitch(String(err));
  process.exit(1);
});
