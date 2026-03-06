/**
 * フィルター群 (v1.1)
 * - Liquidity Filter  : 流動性チェック
 * - Market Regime     : QQQ SMA + SPY SMA + VIX でトレンド判定（強化版）
 * - Earnings Filter   : 決算前後のエントリー禁止
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

  const latest     = bars[bars.length - 1]!;
  const lookback   = Math.min(bars.length, CONFIG.LOOKBACK);
  const recentBars = bars.slice(-lookback);

  if (latest.close < CONFIG.MIN_PRICE) {
    return {
      passed: false,
      reason: `株価 $${latest.close.toFixed(2)} < 最低値 $${CONFIG.MIN_PRICE}`,
    };
  }

  const avgVol = average(recentBars.map((b) => b.volume));
  if (avgVol < CONFIG.MIN_AVG_VOLUME) {
    return {
      passed: false,
      reason: `平均出来高 ${Math.round(avgVol).toLocaleString()} < ${CONFIG.MIN_AVG_VOLUME.toLocaleString()}`,
    };
  }

  return {
    passed: true,
    reason: `OK (price=$${latest.close.toFixed(2)}, avgVol=${Math.round(avgVol).toLocaleString()})`,
  };
}

// ─── 市場レジームフィルター ───────────────────────────────────────────────────

/** サブフィルターごとの判定詳細 */
export interface RegimeDetails {
  qqq: { close: number; sma50: number; sma200: number; passed: boolean } | null;
  spy: { close: number; sma200: number; passed: boolean } | null;
  vix: { close: number; passed: boolean } | null;
  vixSkipped: boolean;  // VIX データ未取得のためスキップ
}

export interface RegimeResult {
  passed: boolean;
  reason: string;
  sma50?: number;
  sma200?: number;
  details: RegimeDetails;
}

/**
 * 市場レジームフィルター v1.1
 *
 * 判定フロー:
 *  1. QQQ: close > SMA200 AND SMA50 > SMA200
 *  2. SPY: close > SMA200（spyBars が SMA_SLOW 件以上ある場合のみ）
 *  3. VIX: close < VIX_MAX（vixBars がある場合のみ。空の場合は警告してスキップ）
 *
 * @param qqqBars 古い→新しい順（SMA_SLOW+1 件必要）
 * @param spyBars SPY バー（省略 / 不足時はスキップ）
 * @param vixBars VIX バー（省略 / 空時はスキップしてボット継続）
 */
export function marketRegimeFilter(
  qqqBars: PriceRow[],
  spyBars?: PriceRow[],
  vixBars?: PriceRow[],
): RegimeResult {
  const details: RegimeDetails = {
    qqq:        null,
    spy:        null,
    vix:        null,
    vixSkipped: false,
  };

  // ─── 1. QQQ チェック ───────────────────────────────────────────────────────
  const closes = qqqBars.map((b) => b.close);
  const sma50  = sma(closes, CONFIG.SMA_FAST);
  const sma200 = sma(closes, CONFIG.SMA_SLOW);

  if (sma50 === null || sma200 === null) {
    return {
      passed: false,
      reason: `データ不足 (${qqqBars.length}件, SMA${CONFIG.SMA_FAST}/SMA${CONFIG.SMA_SLOW}計算不可)`,
      details,
    };
  }

  const qqqClose    = closes[closes.length - 1]!;
  const aboveSma200 = qqqClose > sma200;
  const smaUptrend  = sma50 > sma200;

  details.qqq = { close: qqqClose, sma50, sma200, passed: aboveSma200 && smaUptrend };

  if (!aboveSma200) {
    return {
      passed: false,
      reason: `QQQ close(${qqqClose.toFixed(2)}) <= SMA200(${sma200.toFixed(2)})`,
      sma50, sma200, details,
    };
  }
  if (!smaUptrend) {
    return {
      passed: false,
      reason: `QQQ SMA50(${sma50.toFixed(2)}) <= SMA200(${sma200.toFixed(2)})`,
      sma50, sma200, details,
    };
  }

  // ─── 2. SPY チェック ───────────────────────────────────────────────────────
  if (spyBars && spyBars.length >= CONFIG.SMA_SLOW) {
    const spyCloses = spyBars.map((b) => b.close);
    const spySma200 = sma(spyCloses, CONFIG.SMA_SLOW);
    const spyLatest = spyCloses[spyCloses.length - 1]!;

    if (spySma200 !== null) {
      const spyPassed = spyLatest > spySma200;
      details.spy = { close: spyLatest, sma200: spySma200, passed: spyPassed };

      if (!spyPassed) {
        return {
          passed: false,
          reason: `SPY close(${spyLatest.toFixed(2)}) <= SMA200(${spySma200.toFixed(2)})`,
          sma50, sma200, details,
        };
      }
    }
  }

  // ─── 3. VIX チェック ───────────────────────────────────────────────────────
  if (!vixBars || vixBars.length === 0) {
    // データなし → スキップしてボット継続
    details.vixSkipped = true;
    logger.warn('[Regime] VIXデータなし → VIXフィルターをスキップ（ボット継続）');
  } else {
    const vixLatest = vixBars[vixBars.length - 1]!;
    const vixPassed = vixLatest.close < CONFIG.VIX_MAX;
    details.vix = { close: vixLatest.close, passed: vixPassed };

    if (!vixPassed) {
      return {
        passed: false,
        reason: `VIX(${vixLatest.close.toFixed(2)}) >= 上限${CONFIG.VIX_MAX} → 高ボラティリティ環境`,
        sma50, sma200, details,
      };
    }
  }

  // ─── 全通過 ────────────────────────────────────────────────────────────────
  const spyStr = details.spy
    ? ` | SPY ${details.spy.close.toFixed(2)}>${details.spy.sma200.toFixed(2)}`
    : '';
  const vixStr = details.vixSkipped
    ? ' | VIX:N/A'
    : details.vix
      ? ` | VIX ${details.vix.close.toFixed(1)}<${CONFIG.VIX_MAX}`
      : '';

  return {
    passed: true,
    reason: `OK (QQQ ${qqqClose.toFixed(2)}, SMA50=${sma50.toFixed(2)}, SMA200=${sma200.toFixed(2)}${spyStr}${vixStr})`,
    sma50, sma200, details,
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
    const before = addBusinessDays(earningsDate, -buf);
    const after  = addBusinessDays(earningsDate, buf);

    if (today >= before && today <= after) {
      logger.info(
        `[EarningsFilter] ${symbol}: 決算 ${earningsDate} 前後 ${buf} 営業日のためスキップ`,
      );
      return false;
    }
  }
  return true;
}

/** config/earnings.csv を読み込んで EarningsMap を返す */
export function loadEarningsMap(csvPath: string): EarningsMap {
  const map = new Map<string, string[]>();
  try {
    const fs = require('fs') as typeof import('fs');
    const content = fs.readFileSync(csvPath, 'utf-8');
    const lines = content.split('\n').slice(1);
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
