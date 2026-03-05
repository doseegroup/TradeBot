/**
 * 紙トレード実行エンジン
 * - エントリー / イグジットの判定と仮約定
 * - Kill Switch チェック
 * - 日次リスク管理との連携
 */
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { assertKillSwitchInactive } from '../utils/killswitch.js';
import {
  getOHLCV,
  insertPosition, updatePositionHighestPrice, deletePosition, getOpenPositions,
  insertOrder, insertTrade, insertSignal,
} from '../db/queries.js';
import { evaluateEntry, evaluateExit, calcQuantity } from '../strategy/breakout.js';
import { canEnterPosition, updateDailyRisk, initDailyRisk } from '../risk/manager.js';
import type { Position, Trade, Order } from '../types/index.js';

/** メイン処理: 全ウォッチリスト銘柄を処理する */
export async function runTradingCycle(symbols: string[], date: string): Promise<{
  entered: string[];
  exited: string[];
  signals: string[];
}> {
  assertKillSwitchInactive();
  initDailyRisk(date);

  const entered: string[] = [];
  const exited:  string[] = [];
  const signals: string[] = [];

  // ─── Step 1: 既存ポジションのイグジット判定 ─────────────────────────────────
  const openPositions = getOpenPositions();
  for (const pos of openPositions) {
    try {
      assertKillSwitchInactive();

      const bars = getOHLCV(pos.symbol, 1);
      const latestBar = bars[0];
      if (!latestBar || latestBar.date !== date) {
        logger.warn(`${pos.symbol}: ${date} のデータがありません（イグジット評価スキップ）`);
        continue;
      }

      // 最高値の更新（トレイリングストップ用）
      if (latestBar.close > pos.highestPrice) {
        updatePositionHighestPrice(pos.symbol, latestBar.close);
        pos.highestPrice = latestBar.close;
      }

      const exitCheck = evaluateExit(pos, latestBar);
      if (exitCheck.shouldExit && exitCheck.reason && exitCheck.exitPrice) {
        await closePosition(pos, exitCheck.exitPrice, exitCheck.reason, date);
        exited.push(pos.symbol);
      }
    } catch (err) {
      logger.error(`${pos.symbol} イグジット処理エラー:`, err);
    }
  }

  // ─── Step 2: エントリーシグナル評価 ─────────────────────────────────────────
  for (const symbol of symbols) {
    try {
      assertKillSwitchInactive();

      // 既存ポジションはスキップ
      if (getOpenPositions().some((p) => p.symbol === symbol)) continue;

      const bars = getOHLCV(symbol, config.lookbackDays + 2);
      if (bars.length === 0) {
        logger.debug(`${symbol}: DB にデータなし`);
        continue;
      }

      // 最新バーが今日のものか確認
      const latestBar = bars[bars.length - 1]!;
      if (latestBar.date !== date) {
        logger.debug(`${symbol}: 最新データが ${latestBar.date}（${date} 期待）`);
        continue;
      }

      const signal = evaluateEntry(bars);
      if (!signal) continue;

      signals.push(`${symbol}: ${signal.reason}`);
      insertSignal(signal);

      // リスクチェック
      const riskCheck = canEnterPosition(symbol);
      if (!riskCheck.allowed) {
        logger.info(`エントリースキップ [${symbol}]: ${riskCheck.reason}`);
        continue;
      }

      // ポジションオープン
      const quantity = calcQuantity(signal.price, config.positionSizeUsd);
      if (quantity === 0) {
        logger.warn(`${symbol}: 数量 0 のためエントリーをスキップ`);
        continue;
      }

      const stopLoss   = signal.price * (1 - config.stopLossPct);
      const takeProfit = signal.price * (1 + config.takeProfitPct);

      const position: Position = {
        symbol,
        quantity,
        entryPrice:   signal.price,
        entryDate:    date,
        highestPrice: signal.price,
        stopLoss,
        takeProfit,
      };
      insertPosition(position);

      const order: Order = {
        symbol,
        date,
        type:     'BUY',
        quantity,
        price:    signal.price,
        status:   'FILLED',
        reason:   signal.reason,
      };
      insertOrder(order);

      logger.info(
        `[BUY] ${symbol} × ${quantity} @ $${signal.price.toFixed(2)} | ` +
        `SL: $${stopLoss.toFixed(2)} TP: $${takeProfit.toFixed(2)} | ` +
        signal.reason,
      );
      entered.push(symbol);
    } catch (err) {
      logger.error(`${symbol} エントリー処理エラー:`, err);
    }
  }

  return { entered, exited, signals };
}

/** ポジションをクローズして取引履歴に記録 */
async function closePosition(
  pos: Position,
  exitPrice: number,
  reason: Trade['reason'],
  date: string,
): Promise<void> {
  const pnl    = (exitPrice - pos.entryPrice) * pos.quantity;
  const pnlPct = (exitPrice - pos.entryPrice) / pos.entryPrice;

  const trade: Trade = {
    symbol:     pos.symbol,
    entryDate:  pos.entryDate,
    exitDate:   date,
    entryPrice: pos.entryPrice,
    exitPrice,
    quantity:   pos.quantity,
    pnl,
    pnlPct,
    reason,
  };
  insertTrade(trade);

  const order: Order = {
    symbol:   pos.symbol,
    date,
    type:     'SELL',
    quantity: pos.quantity,
    price:    exitPrice,
    status:   'FILLED',
    reason,
  };
  insertOrder(order);

  deletePosition(pos.symbol);
  updateDailyRisk(date, pnl);

  const pnlSign = pnl >= 0 ? '+' : '';
  logger.info(
    `[SELL] ${pos.symbol} × ${pos.quantity} @ $${exitPrice.toFixed(2)} | ` +
    `PnL: ${pnlSign}$${pnl.toFixed(2)} (${pnlSign}${(pnlPct * 100).toFixed(2)}%) | ${reason}`,
  );
}
