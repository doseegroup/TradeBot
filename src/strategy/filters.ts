/**
 * フィルター群
 * - Liquidity Filter : 流動性チェック
 * - Market Regime    : QQQ SMA でトレンド判定
 * - Earnings Filter  : 決算前後のエントリー禁止
 */
import type { PriceRow } from '../db/prices';
import { CONFIG } from '../config/index';
import { sma, average } from '../utils/math';
import { addBusinessDays } from '../utils/date';
import { logger } from '../utils/logger';

// ─── 流動性フィルター ─────────────────────────────────────────────────────────

export interface LiquidityResult {
  passed: boolean;
  reason: string;
}

/**
 * 流動性フィルター
 * @param bars 古い→新しい順（少なくとも lookback 件必要）
 */
export function liquidityFilter(bars: PriceRow[]): LiquidityResult {
  if (bars.length === 0) return { passed: false, reason: 'データなし' };

  const latest  = bars[bars.length - 1]!;
  const lookback = Math.min(bars.length, CONFIG.LOOKBACK);
  const recentBars = bars.slice(-lookback);

  // 株価チェック
  if (latest.close < CONFIG.MIN_PRICE) {
    return {
      passed: false,
      reason: `株価 $${latest.close.toFixed(2)} < 最低値 $${CONFIG.MIN_PRICE}`,
    };
  }

  // 平均出来高チェック
  const avgVol = average(recentBars.map((b) => b.volume));
  if (avgVol < CONFIG.MIN_AVG_VOLUME) {
    return {
      passed: false,
      reason: `平均出来高 ${Math.round(avgVol).toLocaleString()} < ${CONFIG.MIN_AVG_VOLUME.toLocaleString()}`,
    };
  }

  return { passed: true, reason: `OK (price=$${latest.close.toFixed(2)}, avgVol=${Math.round(avgVol).toLocaleString()})` };
}

// ─── 市場レジームフィルター ───────────────────────────────────────────────────

export interface RegimeResult {
  passed: boolean;
  reason: string;
  sma50?: number;
  sma200?: number;
}

/**
 * 市場レジームフィルター（QQQ）
 * QQQ close > SMA200 AND SMA50 > SMA200 を満たさない場合は新規エントリー禁止
 * @param qqqBars 古い→新しい順
 */
export function marketRegimeFilter(qqqBars: PriceRow[]): RegimeResult {
  const closes = qqqBars.map((b) => b.close);

  const sma50  = sma(closes, CONFIG.SMA_FAST);
  const sma200 = sma(closes, CONFIG.SMA_SLOW);

  if (sma50 === null || sma200 === null) {
    return {
      passed: false,
      reason: `データ不足 (${qqqBars.length}件, SMA${CONFIG.SMA_FAST}/SMA${CONFIG.SMA_SLOW}計算不可)`,
    };
  }

  const latest = closes[closes.length - 1]!;
  const aboveSma200 = latest > sma200;
  const smaUptrend  = sma50 > sma200;

  if (!aboveSma200) {
    return {
      passed: false,
      reason: `QQQ close(${latest.toFixed(2)}) <= SMA200(${sma200.toFixed(2)})`,
      sma50, sma200,
    };
  }

  if (!smaUptrend) {
    return {
      passed: false,
      reason: `QQQ SMA50(${sma50.toFixed(2)}) <= SMA200(${sma200.toFixed(2)})`,
      sma50, sma200,
    };
  }

  return {
    passed: true,
    reason: `OK (close=${latest.toFixed(2)}, SMA50=${sma50.toFixed(2)}, SMA200=${sma200.toFixed(2)})`,
    sma50, sma200,
  };
}

// ─── 決算フィルター ───────────────────────────────────────────────────────────

/** CSV から読み込んだ決算日マップ: Map<symbol, dates[]> */
export type EarningsMap = Map<string, string[]>;

/**
 * 決算フィルター
 * 決算日の前後 EARNINGS_BUFFER 営業日は新規エントリー禁止
 */
export function earningsFilter(symbol: string, today: string, earningsMap: EarningsMap): boolean {
  const dates = earningsMap.get(symbol) ?? [];
  const buf   = CONFIG.EARNINGS_BUFFER;

  for (const earningsDate of dates) {
    // 前 N 営業日
    const before = addBusinessDays(earningsDate, -buf);
    // 後 N 営業日
    const after  = addBusinessDays(earningsDate, buf);

    if (today >= before && today <= after) {
      logger.info(
        `[EarningsFilter] ${symbol}: 決算 ${earningsDate} 前後 ${buf} 営業日のためスキップ`,
      );
      return false; // エントリー禁止
    }
  }
  return true; // エントリー可
}

/** config/earnings.csv を読み込んで EarningsMap を返す */
export function loadEarningsMap(csvPath: string): EarningsMap {
  const map = new Map<string, string[]>();
  try {
    const fs = require('fs') as typeof import('fs');
    const content = fs.readFileSync(csvPath, 'utf-8');
    const lines = content.split('\n').slice(1); // ヘッダースキップ
    for (const line of lines) {
      const [symbol, date] = line.trim().split(',');
      if (!symbol || !date) continue;
      const existing = map.get(symbol) ?? [];
      existing.push(date);
      map.set(symbol, existing);
    }
  } catch (err) {
    logger.warn(`earnings.csv 読み込みエラー: ${err}`);
  }
  return map;
}
