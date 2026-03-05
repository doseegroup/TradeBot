/**
 * ペーパートレード実行エンジン（v2）
 *
 * 約定モデル：
 *   エントリー : シグナル当日に PENDING オーダー作成 → 翌営業日の始値で約定
 *   イグジット : SL/TP/Trailing を毎日終値でチェック → 当日終値で即時約定
 *
 * スリッページ：
 *   買い : fillPrice = open * (1 + SLIPPAGE_PCT)
 *   売り : fillPrice = close * (1 - SLIPPAGE_PCT)
 */
import { CONFIG } from '../config/index';
import { logger } from '../utils/logger';
import { getPendingOrders, insertOrder, updateOrderStatus, insertFill } from '../db/orders';
import { getAllPositions, upsertPosition, updateHighestPrice, deletePosition } from '../db/positions';
import { insertSignal } from '../db/signals';
import { getBar } from '../db/prices';
import { updateConsecutiveLosses, checkDailyLoss, getCurrentEquity } from '../risk/engine';
import { todayString } from '../utils/date';

export interface FillResult {
  symbol: string;
  side: 'BUY' | 'SELL';
  qty: number;
  fillPrice: number;
  pnl?: number;
  reason?: string;
}

// ─── T+1 PENDING 注文の約定処理 ───────────────────────────────────────────────

/**
 * 昨日作成された PENDING 注文を今日の始値で約定させる
 */
export async function fillPendingOrders(today: string): Promise<FillResult[]> {
  const results: FillResult[] = [];
  const pending = getPendingOrders();

  for (const order of pending) {
    // 今日より古いオーダーのみ約定（当日は翌日まで待つ）
    if (order.date >= today) continue;

    const bar = getBar(order.symbol, today);
    if (!bar) {
      logger.warn(`[Fill] ${order.symbol}: ${today} のデータなし → スキップ`);
      continue;
    }

    let fillPrice: number;
    if (bar.open > 0) {
      fillPrice = bar.open;
    } else {
      fillPrice = bar.close;
      logger.warn(`[Fill] ${order.symbol}: 始値なし → 終値 $${bar.close.toFixed(2)} で約定`);
    }

    // スリッページ適用
    if (order.side === 'BUY') {
      fillPrice *= 1 + CONFIG.SLIPPAGE_PCT;
    } else {
      fillPrice *= 1 - CONFIG.SLIPPAGE_PCT;
    }

    // fills テーブルに記録
    insertFill({ order_id: order.id, date: today, price: fillPrice, qty: order.qty });
    updateOrderStatus(order.id, 'FILLED');

    if (order.side === 'BUY') {
      // ポジションオープン
      const stopLoss   = fillPrice * (1 - CONFIG.STOP_LOSS_PCT);
      const takeProfit = fillPrice * (1 + CONFIG.TAKE_PROFIT_PCT);
      upsertPosition({
        symbol:        order.symbol,
        qty:           order.qty,
        avg_price:     fillPrice,
        realized_pnl:  0,
        updated_at:    today,
        entry_date:    today,
        entry_price:   fillPrice,
        highest_price: fillPrice,
        stop_loss:     stopLoss,
        take_profit:   takeProfit,
      });
      logger.info(
        `[BUY 約定] ${order.symbol} ×${order.qty} @ $${fillPrice.toFixed(2)} ` +
        `| SL: $${stopLoss.toFixed(2)} TP: $${takeProfit.toFixed(2)}`,
      );
    }

    results.push({ symbol: order.symbol, side: order.side, qty: order.qty, fillPrice });
  }

  return results;
}

// ─── イグジット評価 ───────────────────────────────────────────────────────────

/**
 * 全保有ポジションのイグジット条件を評価し、条件成立なら即日クローズ
 */
export async function checkAndExit(today: string): Promise<FillResult[]> {
  const results: FillResult[] = [];
  const positions = getAllPositions();

  for (const pos of positions) {
    const bar = getBar(pos.symbol, today);
    if (!bar) {
      logger.warn(`[Exit] ${pos.symbol}: ${today} のデータなし → スキップ`);
      continue;
    }

    // 最高値の更新（トレイリングストップ用）
    const highest = pos.highest_price ?? pos.avg_price;
    if (bar.high > highest) {
      updateHighestPrice(pos.symbol, bar.high, today);
      pos.highest_price = bar.high;
    }

    let exitReason: string | null = null;

    // ─ Take Profit ──────────────────────────────────────────────────────────
    if (bar.close >= pos.avg_price * (1 + CONFIG.TAKE_PROFIT_PCT)) {
      exitReason = 'TAKE_PROFIT';
    }
    // ─ Stop Loss ────────────────────────────────────────────────────────────
    else if (bar.close <= pos.avg_price * (1 - CONFIG.STOP_LOSS_PCT)) {
      exitReason = 'STOP_LOSS';
    }
    // ─ Trailing Stop ────────────────────────────────────────────────────────
    else if (CONFIG.TRAILING_STOP_ENABLED && pos.highest_price) {
      const trailLevel = pos.highest_price * (1 - CONFIG.TRAILING_STOP_PCT);
      if (bar.close <= trailLevel) {
        exitReason = 'TRAILING_STOP';
      }
    }

    if (!exitReason) continue;

    // イグジット約定（当日終値 × スリッページ）
    const fillPrice = bar.close * (1 - CONFIG.SLIPPAGE_PCT);
    const pnl       = (fillPrice - pos.avg_price) * pos.qty;
    const pnlPct    = (fillPrice - pos.avg_price) / pos.avg_price;

    // SELL オーダー + フィル を記録
    const orderId = insertOrder({
      date:   today,
      symbol: pos.symbol,
      side:   'SELL',
      qty:    pos.qty,
      price:  fillPrice,
      status: 'FILLED',
    });
    insertFill({ order_id: orderId, date: today, price: fillPrice, qty: pos.qty });

    // シグナルにも残す
    insertSignal({
      date:      today,
      symbol:    pos.symbol,
      action:    'SELL',
      reason:    exitReason,
      meta_json: JSON.stringify({ pnl, pnlPct, entryPrice: pos.avg_price, exitPrice: fillPrice }),
    });

    // ポジション削除
    deletePosition(pos.symbol);

    // 連続損失追跡
    updateConsecutiveLosses(pnl >= 0);

    // 日次損失チェック（Kill Switch 判定）
    const equity = getCurrentEquity() + pnl;
    checkDailyLoss(equity);

    const sign = pnl >= 0 ? '+' : '';
    logger.info(
      `[SELL ${exitReason}] ${pos.symbol} ×${pos.qty} @ $${fillPrice.toFixed(2)} ` +
      `| PnL: ${sign}$${pnl.toFixed(2)} (${sign}${(pnlPct * 100).toFixed(2)}%)`,
    );

    results.push({ symbol: pos.symbol, side: 'SELL', qty: pos.qty, fillPrice, pnl, reason: exitReason });
  }

  return results;
}

// ─── 新規エントリーオーダー作成（PENDING）────────────────────────────────────

/**
 * BUY シグナルを PENDING オーダーとして登録する（翌日約定）
 */
export function createBuyOrder(symbol: string, date: string, signalPrice: number, qty: number): string {
  const orderId = insertOrder({
    date,
    symbol,
    side:   'BUY',
    qty,
    price:  signalPrice,
    status: 'PENDING',
  });
  logger.info(
    `[PENDING BUY] ${symbol} ×${qty} @ ~$${signalPrice.toFixed(2)} ` +
    `| 翌営業日始値で約定予定`,
  );
  return orderId;
}

// ─── 資産計算 ─────────────────────────────────────────────────────────────────

/**
 * 現在の仮想資産 = 初期資金 + クローズ済み損益合計 + 未実現損益
 * シンプル実装：equity テーブルの最新値 + 今日の PnL を足す
 */
export function estimateCurrentEquity(fills: FillResult[]): number {
  const baseEquity = getCurrentEquity();
  const todayPnl   = fills.filter((f) => f.pnl !== undefined).reduce((s, f) => s + (f.pnl ?? 0), 0);
  return baseEquity + todayPnl;
}
