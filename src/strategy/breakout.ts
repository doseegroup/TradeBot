/**
 * ブレイクアウト戦略 (v1.1)
 *
 * エントリー条件（BUY）:
 *   1. close_today > highest(high, LOOKBACK)          ← 20日高値ブレイク
 *   2. volume_today > avg(volume, LOOKBACK) × VOLUME_MULT  ← 出来高急増
 *   3. (ENABLE_ATR_BREAKOUT=true の場合)
 *      close_today > highest20 + ATR_MULT × ATR(ATR_PERIOD)  ← ダマシ削減
 *
 * ※ フィルター（流動性・レジーム・決算）は呼び出し元で適用済みであること
 */
import { CONFIG } from '../config/index';
import { highest, average, atr } from '../utils/math';
import type { PriceRow } from '../db/prices';
import { logger } from '../utils/logger';

export interface BreakoutSignal {
  symbol: string;
  date: string;
  action: 'BUY';
  reason: string;
  meta: {
    close: number;
    highMax: number;
    volume: number;
    volAvg: number;
    volRatio: number;
    atrValue?: number;      // ATR_BREAKOUT 有効時に付与
    atrThreshold?: number;  // highMax + ATR_MULT × ATR
  };
}

/**
 * ブレイクアウトシグナルを評価する
 * @param bars 古い→新しい順（LOOKBACK+ATR_PERIOD+1 件以上推奨）
 * @returns シグナル or null
 */
export function evaluateBreakout(bars: PriceRow[]): BreakoutSignal | null {
  const lookback = CONFIG.LOOKBACK;

  if (bars.length < lookback + 1) {
    logger.debug(`${bars[0]?.symbol}: データ不足 (${bars.length}/${lookback + 1})`);
    return null;
  }

  const today   = bars[bars.length - 1]!;
  const history = bars.slice(-(lookback + 1), -1); // 今日を除く lookback 日分

  const highMax  = highest(history.map((b) => b.high));
  const volAvg   = average(history.map((b) => b.volume));
  const volRatio = volAvg > 0 ? today.volume / volAvg : 0;

  const breakHigh   = today.close > highMax;
  const volumeSpike = today.volume > volAvg * CONFIG.VOLUME_MULT;

  logger.debug(
    `[${today.symbol}] close=${today.close.toFixed(2)} highMax=${highMax.toFixed(2)} ` +
    `volRatio=${volRatio.toFixed(2)}x breakHigh=${breakHigh} volSpike=${volumeSpike}`,
  );

  if (!breakHigh || !volumeSpike) return null;

  // ─── ATR ブレイク条件（ダマシ削減） v1.1 ────────────────────────────────────
  let atrValue: number | undefined;
  let atrThreshold: number | undefined;

  if (CONFIG.ENABLE_ATR_BREAKOUT) {
    const atrCalc = atr(bars, CONFIG.ATR_PERIOD);

    if (atrCalc !== null) {
      atrValue     = atrCalc;
      atrThreshold = highMax + CONFIG.ATR_MULT * atrCalc;

      if (today.close <= atrThreshold) {
        logger.debug(
          `[${today.symbol}] ATR条件不足: close=${today.close.toFixed(2)} <= ` +
          `threshold=${atrThreshold.toFixed(2)} ` +
          `(highMax=${highMax.toFixed(2)} + ${CONFIG.ATR_MULT}×ATR=${atrCalc.toFixed(2)})`,
        );
        return null;
      }
    } else {
      // ATR 計算に必要なデータ不足 → 条件スキップ（ブレイクアウトは通過）
      logger.debug(`[${today.symbol}] ATR計算データ不足 → ATR条件スキップ`);
    }
  }

  const atrNote = atrValue !== undefined
    ? ` + ATR上抜け(ATR=${atrValue.toFixed(2)})`
    : '';

  return {
    symbol: today.symbol,
    date:   today.date,
    action: 'BUY',
    reason: `20日高値ブレイク($${highMax.toFixed(2)}) + 出来高急増(${volRatio.toFixed(1)}x)${atrNote}`,
    meta: {
      close:  today.close,
      highMax,
      volume: today.volume,
      volAvg,
      volRatio,
      atrValue,
      atrThreshold,
    },
  };
}

/**
 * ポジションサイジング
 * リスクベース: equity × RISK_PER_TRADE_PCT / (price × SL_PCT)
 * 上限:        MAX_POSITION_USD / price
 */
export function calcPositionSize(equity: number, price: number): number {
  if (price <= 0) return 0;
  const riskUsd    = equity * CONFIG.RISK_PER_TRADE_PCT;
  const riskShares = Math.floor(riskUsd / (price * CONFIG.STOP_LOSS_PCT));
  const maxShares  = Math.floor(CONFIG.MAX_POSITION_USD / price);
  return Math.min(riskShares, maxShares);
}
