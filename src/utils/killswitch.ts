import { getDb } from '../db/index.js';
import { logger } from './logger.js';

/** Kill Switch が有効かどうか確認する */
export function isKillSwitchActive(): boolean {
  const db = getDb();
  const row = db
    .prepare<[], { active: number }>('SELECT active FROM kill_switch ORDER BY id DESC LIMIT 1')
    .get();
  return row?.active === 1;
}

/** Kill Switch を起動する */
export function activateKillSwitch(reason: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO kill_switch (active, reason, activated_at)
    VALUES (1, ?, datetime('now'))
  `).run(reason);
  logger.error(`🚨 Kill Switch 発動: ${reason}`);
}

/** Kill Switch を解除する（手動復旧用） */
export function deactivateKillSwitch(): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO kill_switch (active, reason, activated_at)
    VALUES (0, 'Manual reset', datetime('now'))
  `).run();
  logger.info('✅ Kill Switch を解除しました');
}

/** Kill Switch が有効な場合は例外を投げる */
export function assertKillSwitchInactive(): void {
  if (isKillSwitchActive()) {
    throw new Error('Kill Switch が有効です。手動で解除するまで取引を停止します。');
  }
}

// ─── 連続エラーカウンタ ────────────────────────────────────────────────────────
let _consecutiveErrors = 0;

export function recordError(maxAllowed: number): void {
  _consecutiveErrors++;
  logger.warn(`連続エラー数: ${_consecutiveErrors}/${maxAllowed}`);
  if (_consecutiveErrors >= maxAllowed) {
    activateKillSwitch(`連続エラーが ${maxAllowed} 回に達しました`);
  }
}

export function resetErrorCount(): void {
  _consecutiveErrors = 0;
}
