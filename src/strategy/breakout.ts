/**
 * ブレイクアウト戦略（v2）
 *
 * エントリー条件（BUY）：
 *   close_today > highest(high, lookback)
 *   AND volume_today > avg(volume, lookback) * 2
 *
 * ※ フィルター（流動性・レジーム・決算）は呼び出し元で適用済みであること
 */
import { CONFIG } from '../config/index';
import { highest, average } from '../utils/math';
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
  };
}

/**
 * ブレイクアウトシグナルを評価する
 * @param bars 古い→新しい順（lookback+1 件以上必要）
 * @returns シグナル or null
 */
export function evaluateBreakout(bars: PriceRow[]): BreakoutSignal | null {
  const lookback = CONFIG.LOOKBACK;

  if (bars.length < lookback + 1) {
    logger.debug(`${bars[0]?.symbol}: データ不足 (${bars.length}/${lookback + 1})`);
    return null;
  }

  const today     = bars[bars.length - 1]!;
  const history   = bars.slice(-(lookback + 1), -1); // 今日を除く lookback 日分

  const highMax  = highest(history.map((b) => b.high));
  const volAvg   = average(history.map((b) => b.volume));
  const volRatio = volAvg > 0 ? today.volume / volAvg : 0;

  const breakHigh  = today.close > highMax;
  const volumeSpike = today.volume > volAvg * CONFIG.VOLUME_MULT;

  logger.debug(
    `[${today.symbol}] close=${today.close.toFixed(2)} highMax=${highMax.toFixed(2)} ` +
    `volRatio=${volRatio.toFixed(2)}x breakHigh=${breakHigh} volSpike=${volumeSpike}`,
  );

  if (!breakHigh || !volumeSpike) return null;

  return {
    symbol: today.symbol,
    date:   today.date,
    action: 'BUY',
    reason: `20日高値ブレイク($${highMax.toFixed(2)}) + 出来高急増(${volRatio.toFixed(1)}x)`,
    meta: {
      close:  today.close,
      highMax,
      volume: today.volume,
      volAvg,
      volRatio,
    },
  };
}

/**
 * ポジションサイジング
 * リスクベース: equity * RISK_PER_TRADE_PCT / (price * SL_PCT)
 * 上限:        MAX_POSITION_USD / price
 * @returns 株数（整数）
 */
export function calcPositionSize(equity: number, price: number): number {
  if (price <= 0) return 0;

  // リスクベースのサイズ（stop_loss_pct 分の損失が equity の 1% に収まる株数）
  const riskUsd    = equity * CONFIG.RISK_PER_TRADE_PCT;
  const riskShares = Math.floor(riskUsd / (price * CONFIG.STOP_LOSS_PCT));

  // 金額上限
  const maxShares  = Math.floor(CONFIG.MAX_POSITION_USD / price);

  return Math.min(riskShares, maxShares);
}
