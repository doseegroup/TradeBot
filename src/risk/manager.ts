/**
 * リスク管理
 * - 1日最大損失 -3% で停止
 * - 同時保有最大2
 * - 1銘柄最大投入 positionSizeUsd (USD)
 * - 異常でKill Switch
 */
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { activateKillSwitch } from '../utils/killswitch.js';
import {
  getDailyRisk, upsertDailyRisk, calcCurrentEquity, getOpenPositions,
} from '../db/queries.js';
import type { DailyRisk } from '../types/index.js';

/** 今日の日次リスクレコードを初期化（または取得） */
export function initDailyRisk(date: string): DailyRisk {
  const existing = getDailyRisk(date);
  if (existing) return existing;

  const currentEquity = calcCurrentEquity(config.initialEquity);
  const risk: DailyRisk = {
    date,
    startingEquity: currentEquity,
    currentEquity,
    dailyPnl:       0,
    dailyPnlPct:    0,
    tradeCount:     0,
  };
  upsertDailyRisk(risk);
  return risk;
}

/** 取引後に日次リスクを更新し、Kill Switch を判定する */
export function updateDailyRisk(date: string, realizedPnl: number): void {
  const risk = getDailyRisk(date) ?? initDailyRisk(date);
  const newEquity   = risk.currentEquity + realizedPnl;
  const dailyPnl    = newEquity - risk.startingEquity;
  const dailyPnlPct = dailyPnl / risk.startingEquity;

  const updated: DailyRisk = {
    ...risk,
    currentEquity: newEquity,
    dailyPnl,
    dailyPnlPct,
    tradeCount: risk.tradeCount + 1,
  };
  upsertDailyRisk(updated);

  logger.info(
    `日次損益: ${(dailyPnlPct * 100).toFixed(2)}% ` +
    `(${dailyPnl >= 0 ? '+' : ''}$${dailyPnl.toFixed(2)}) | 取引数: ${updated.tradeCount}`,
  );

  // 日次損失上限チェック
  if (dailyPnlPct <= -config.maxDailyLossPct) {
    activateKillSwitch(
      `日次損失が上限 ${(config.maxDailyLossPct * 100).toFixed(0)}% を超えました ` +
      `(現在: ${(dailyPnlPct * 100).toFixed(2)}%)`,
    );
  }
}

/** 新規エントリーが可能かチェック */
export function canEnterPosition(symbol: string): { allowed: boolean; reason?: string } {
  const positions = getOpenPositions();

  // 既に同じ銘柄のポジションがある
  if (positions.some((p) => p.symbol === symbol)) {
    return { allowed: false, reason: `${symbol}: 既にポジションあり` };
  }

  // 最大同時保有数チェック
  if (positions.length >= config.maxPositions) {
    return {
      allowed: false,
      reason: `同時保有上限 ${config.maxPositions} に達しています (現在: ${positions.length})`,
    };
  }

  return { allowed: true };
}

/** ポートフォリオ概況を返す */
export function getPortfolioSummary(): {
  currentEquity: number;
  openPositions: number;
  todayPnl: number;
  todayPnlPct: number;
} {
  const today     = new Date().toISOString().slice(0, 10);
  const risk      = getDailyRisk(today);
  const positions = getOpenPositions();
  const equity    = calcCurrentEquity(config.initialEquity);

  return {
    currentEquity: equity,
    openPositions: positions.length,
    todayPnl:      risk?.dailyPnl    ?? 0,
    todayPnlPct:   risk?.dailyPnlPct ?? 0,
  };
}
