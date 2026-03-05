/**
 * リスクエンジン（v2）
 * - Kill Switch（日次損失上限）
 * - 3連敗 → 48時間クールダウン
 * - ポジション上限
 * - 日次損失監視
 */
import { CONFIG } from '../config/index';
import { logger } from '../utils/logger';
import {
  isKillSwitchActive, activateKillSwitch,
  isCooldownActive, setCooldown, getCooldownUntil,
  getConsecLosses, setConsecLosses,
  getDayStartEquity, setDayStartEquity,
} from '../db/system';
import { getAllPositions } from '../db/positions';
import { getLatestEquity } from '../db/equity';
import { todayString } from '../utils/date';

// ─── Kill Switch ──────────────────────────────────────────────────────────────

export function checkKillSwitch(): { blocked: boolean; reason?: string } {
  if (isKillSwitchActive()) {
    return { blocked: true, reason: 'Kill Switch が有効です。手動で解除してください。' };
  }
  return { blocked: false };
}

// ─── クールダウン ─────────────────────────────────────────────────────────────

export function checkCooldown(): { blocked: boolean; reason?: string } {
  if (isCooldownActive()) {
    const until = getCooldownUntil();
    return {
      blocked: true,
      reason: `3連敗クールダウン中（解除: ${until}）`,
    };
  }
  return { blocked: false };
}

// ─── 日次損失チェック ─────────────────────────────────────────────────────────

/**
 * 日次開始資産を記録（1日1回）
 */
export function recordDayStart(equity: number): void {
  const today = todayString();
  if (getDayStartEquity(today) === null) {
    setDayStartEquity(today, equity);
    logger.info(`日次開始資産: $${equity.toFixed(2)}`);
  }
}

/**
 * 現在の日次損益をチェックし、上限超過なら Kill Switch を発動
 */
export function checkDailyLoss(currentEquity: number): boolean {
  const today      = todayString();
  const startEquity = getDayStartEquity(today);
  if (!startEquity) return false;

  const dailyPnl    = currentEquity - startEquity;
  const dailyPnlPct = dailyPnl / startEquity;

  if (dailyPnlPct <= -CONFIG.MAX_DAILY_LOSS_PCT) {
    const msg = `日次損失が上限 ${(CONFIG.MAX_DAILY_LOSS_PCT * 100).toFixed(0)}% を超えました ` +
                `(${(dailyPnlPct * 100).toFixed(2)}%)`;
    activateKillSwitch(msg);
    logger.error(`🚨 ${msg}`);
    return true;
  }
  return false;
}

// ─── 連続損失追跡 ─────────────────────────────────────────────────────────────

/**
 * トレード結果を反映。勝利なら連敗リセット、敗北なら加算し上限チェック
 */
export function updateConsecutiveLosses(won: boolean): void {
  if (won) {
    setConsecLosses(0);
    logger.debug('連続損失: リセット');
    return;
  }

  const count = getConsecLosses() + 1;
  setConsecLosses(count);
  logger.info(`連続損失: ${count}/${CONFIG.CONSEC_LOSS_LIMIT}`);

  if (count >= CONFIG.CONSEC_LOSS_LIMIT) {
    const until = new Date();
    until.setHours(until.getHours() + CONFIG.COOLDOWN_HOURS);
    setCooldown(until.toISOString());
    logger.warn(
      `🔴 ${CONFIG.CONSEC_LOSS_LIMIT}連敗 → ${CONFIG.COOLDOWN_HOURS}時間クールダウン (解除: ${until.toISOString()})`,
    );
  }
}

// ─── ポジション上限 ───────────────────────────────────────────────────────────

export function canEnter(symbol: string): { allowed: boolean; reason?: string } {
  const positions = getAllPositions();

  if (positions.some((p) => p.symbol === symbol)) {
    return { allowed: false, reason: `${symbol}: 既に保有中` };
  }

  if (positions.length >= CONFIG.MAX_POSITIONS) {
    return {
      allowed: false,
      reason: `最大保有数 ${CONFIG.MAX_POSITIONS} に到達 (現在: ${positions.length})`,
    };
  }

  return { allowed: true };
}

// ─── 現在の資産額を推定 ───────────────────────────────────────────────────────

/**
 * equity テーブルの最新値、またはフォールバックとして初期資金を返す
 */
export function getCurrentEquity(): number {
  const row = getLatestEquity();
  return row?.equity ?? CONFIG.INITIAL_EQUITY;
}
