/**
 * system_state テーブルの操作 (v1.1)
 * Kill Switch、クールダウン、連敗カウント、日次実行コンテキストなどを管理
 */
import { getDb } from './client';

export function setState(key: string, value: string): void {
  getDb().prepare(`
    INSERT INTO system_state (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
  `).run(key, value);
}

export function getState(key: string): string | null {
  const row = getDb()
    .prepare<[string], { value: string }>('SELECT value FROM system_state WHERE key=?')
    .get(key);
  return row?.value ?? null;
}

// ─── Kill Switch ──────────────────────────────────────────────────────────────

export function isKillSwitchActive(): boolean {
  return getState('kill_switch') === '1';
}

export function activateKillSwitch(reason: string): void {
  setState('kill_switch', '1');
  setState('kill_switch_reason', reason);
  setState('kill_switch_at', new Date().toISOString());
}

export function deactivateKillSwitch(): void {
  setState('kill_switch', '0');
}

// ─── クールダウン ─────────────────────────────────────────────────────────────

export function setCooldown(untilIso: string): void {
  setState('cooldown_until', untilIso);
}

export function isCooldownActive(): boolean {
  const until = getState('cooldown_until');
  if (!until) return false;
  return new Date(until) > new Date();
}

export function getCooldownUntil(): string | null {
  return getState('cooldown_until');
}

// ─── 連続損失カウント ─────────────────────────────────────────────────────────

export function getConsecLosses(): number {
  return parseInt(getState('consec_losses') ?? '0', 10);
}

export function setConsecLosses(n: number): void {
  setState('consec_losses', String(n));
}

// ─── 日次開始資産 ─────────────────────────────────────────────────────────────

export function setDayStartEquity(date: string, equity: number): void {
  setState(`day_start_equity_${date}`, String(equity));
}

export function getDayStartEquity(date: string): number | null {
  const v = getState(`day_start_equity_${date}`);
  return v ? parseFloat(v) : null;
}

// ─── 日次実行コンテキスト（レポート参照用）v1.1 ──────────────────────────────

export interface DailyRunContext {
  regime: {
    passed: boolean;
    reason: string;
    details?: {
      qqq: { close: number; sma50: number; sma200: number; passed: boolean } | null;
      spy: { close: number; sma200: number; passed: boolean } | null;
      vix: { close: number; passed: boolean } | null;
      vixSkipped: boolean;
    };
  } | null;
  skippedByFilters: number;   // 流動性/決算フィルターでブロックされた銘柄数
  consecLosses: number;
  cooldownActive: boolean;
  cooldownUntil: string | null;
}

export function setDailyRunContext(date: string, ctx: DailyRunContext): void {
  setState(`run_context_${date}`, JSON.stringify(ctx));
}

export function getDailyRunContext(date: string): DailyRunContext | null {
  const v = getState(`run_context_${date}`);
  if (!v) return null;
  try {
    return JSON.parse(v) as DailyRunContext;
  } catch {
    return null;
  }
}
