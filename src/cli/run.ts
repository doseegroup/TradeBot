/**
 * npm run run
 * フル取引サイクル v1.1:
 *   fetch → VIX fetch（失敗時スキップ）→ T+1 約定 → イグジット評価
 *   → レジーム(QQQ/SPY/VIX)フィルター → ブレイクアウト(ATR条件込み)
 *   → 新規 PENDING オーダー → 資産更新 → LINE 通知
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
import {
  liquidityFilter, marketRegimeFilter, earningsFilter, loadEarningsMap,
} from '../strategy/filters';
import type { RegimeResult } from '../strategy/filters';

// Breakout
import { evaluateBreakout, calcPositionSize } from '../strategy/breakout';

// Risk
import {
  checkKillSwitch, checkCooldown, recordDayStart, getCurrentEquity, canEnter,
} from '../risk/engine';

// Paper execution
import { fillPendingOrders, checkAndExit, createBuyOrder } from '../paper/executor';

// DB
import { insertSignal } from '../db/signals';
import { upsertEquity, getEquityHistory } from '../db/equity';
import { getAllPositions } from '../db/positions';
import {
  isKillSwitchActive,
  getConsecLosses, isCooldownActive, getCooldownUntil,
  setDailyRunContext,
} from '../db/system';

// Notify
import {
  notifySignal, notifyFill, notifyDailySummary, notifyKillSwitch,
} from '../notify/line';
import { maxDrawdown } from '../utils/math';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const watchlist = require('../../config/watchlist.json') as { symbols: string[] };

async function main(): Promise<void> {
  runMigrations();
  setLogDb(getDb());
  logger.info('=== トレーディングサイクル開始 ===');

  const provider = createProvider();

  // ─── Kill Switch チェック ─────────────────────────────────────────────────
  const ks = checkKillSwitch();
  if (ks.blocked) {
    logger.error(ks.reason);
    await notifyKillSwitch(ks.reason ?? '');
    process.exit(1);
  }

  const today   = todayString();
  const symbols = watchlist.symbols as string[];

  // ─── Step 1: データフェッチ（ウォッチリスト全銘柄）────────────────────────
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

      if (startDate > today) continue;

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

  // ─── VIX フェッチ（失敗してもボット継続）────────────────────────────────
  let vixBars = getPriceBars(CONFIG.VIX_SYMBOL, 5);
  try {
    const vixLast  = latestDate(CONFIG.VIX_SYMBOL);
    const vixStart = vixLast
      ? (() => {
          const d = new Date(vixLast + 'T12:00:00Z');
          d.setUTCDate(d.getUTCDate() + 1);
          return d.toISOString().slice(0, 10);
        })()
      : daysAgo(10);

    if (vixStart <= today) {
      const bars = await withRetry(
        () => provider.fetchDaily(CONFIG.VIX_SYMBOL, vixStart, today), 2, 2000,
      );
      if (bars.length > 0) upsertPrices(bars);
    }
    vixBars = getPriceBars(CONFIG.VIX_SYMBOL, 5);
    if (vixBars.length > 0) {
      logger.debug(`[VIX] 最新: ${vixBars[vixBars.length - 1]?.close.toFixed(2)}`);
    }
  } catch (err) {
    logger.warn(`[VIX] データ取得失敗 → VIXフィルターを無効化: ${(err as Error).message}`);
  }

  // 日次開始資産記録
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
    await saveCtxAndFinalize(today, [], exitedSymbols, [], null, 0);
    return;
  }
  const cd = checkCooldown();
  if (cd.blocked) {
    logger.warn(`クールダウン中 → 新規エントリースキップ: ${cd.reason}`);
    await saveCtxAndFinalize(today, [], exitedSymbols, [], null, 0);
    return;
  }

  // ─── Step 5: 市場レジームフィルター（QQQ / SPY / VIX）────────────────────
  logger.info('[Step 5] 市場レジームフィルター');
  const qqqBars = getPriceBars(CONFIG.BENCHMARK,  CONFIG.SMA_SLOW + 10);
  const spyBars = getPriceBars(CONFIG.SPY_SYMBOL, CONFIG.SMA_SLOW + 10);
  const regime  = marketRegimeFilter(
    qqqBars,
    spyBars.length >= CONFIG.SMA_SLOW ? spyBars : undefined,
    vixBars.length > 0 ? vixBars : undefined,
  );
  logger.info(`[Regime] ${regime.passed ? 'OK' : 'NG'}: ${regime.reason}`);

  if (!regime.passed) {
    logger.info('レジームフィルター不通過 → 新規エントリーをスキップ');
    await saveCtxAndFinalize(today, [], exitedSymbols, [], regime, 0);
    return;
  }

  // ─── Step 6〜8: 各銘柄のシグナル評価 ─────────────────────────────────────
  logger.info('[Step 6-8] シグナル評価');
  const earningsMap = loadEarningsMap(path.join(process.cwd(), 'config', 'earnings.csv'));
  const enteredSymbols: string[] = [];
  const signalSymbols:  string[] = [];

  // レジーム・VIX 用シンボルは売買対象外
  const nonTrading = new Set<string>([CONFIG.BENCHMARK, CONFIG.SPY_SYMBOL, CONFIG.VIX_SYMBOL]);
  const tradingSymbols = symbols.filter((s) => !nonTrading.has(s));

  let skippedByFilters = 0;

  for (const symbol of tradingSymbols) {
    try {
      const bars = getPriceBars(symbol, CONFIG.LOOKBACK + CONFIG.ATR_PERIOD + 5);

      // 流動性フィルター
      const liq = liquidityFilter(bars);
      if (!liq.passed) {
        logger.debug(`[LiqFilter] ${symbol}: ${liq.reason}`);
        skippedByFilters++;
        continue;
      }

      // 決算フィルター
      if (!earningsFilter(symbol, today, earningsMap)) {
        skippedByFilters++;
        continue;
      }

      // ポジション上限・重複チェック
      const canEnterCheck = canEnter(symbol);
      if (!canEnterCheck.allowed) {
        logger.debug(`[RiskCheck] ${symbol}: ${canEnterCheck.reason}`);
        continue; // ポジション上限はスキップカウント外
      }

      // ブレイクアウト評価（ATR 条件込み）
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

      // ポジションサイズ決定
      const equity = getCurrentEquity();
      const qty    = calcPositionSize(equity, signal.meta.close);
      if (qty === 0) {
        logger.warn(`${symbol}: ポジションサイズ 0 → スキップ`);
        skippedByFilters++;
        continue;
      }

      // PENDING オーダー作成（T+1 約定）
      createBuyOrder(symbol, today, signal.meta.close, qty);
      enteredSymbols.push(symbol);
      await notifySignal(symbol, today, signal.reason, signal.meta.close);
    } catch (err) {
      logger.error(`${symbol} シグナル評価エラー:`, err);
    }
  }

  await saveCtxAndFinalize(today, enteredSymbols, exitedSymbols, signalSymbols, regime, skippedByFilters);
}

// ─── コンテキスト保存 + 最終処理 ─────────────────────────────────────────────

async function saveCtxAndFinalize(
  today: string,
  entered: string[],
  exited: string[],
  signals: string[],
  regime: RegimeResult | null,
  skippedByFilters: number,
): Promise<void> {
  // 日次実行コンテキストを DB に保存（npm run report 時に参照）
  setDailyRunContext(today, {
    regime: regime
      ? { passed: regime.passed, reason: regime.reason, details: regime.details }
      : null,
    skippedByFilters,
    consecLosses:  getConsecLosses(),
    cooldownActive: isCooldownActive(),
    cooldownUntil:  getCooldownUntil(),
  });

  // ─── Step 9: equity テーブル更新 ─────────────────────────────────────────
  const equity  = getCurrentEquity();
  const history = getEquityHistory(365);
  const dd      = maxDrawdown([...history.map((e) => e.equity), equity]);
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
