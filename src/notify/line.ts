/**
 * LINE Messaging API 通知（v2）
 * 失敗してもボットが落ちないよう try/catch で包む
 */
import axios from 'axios';
import { CONFIG } from '../config/index';
import { logger } from '../utils/logger';

const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';

async function push(text: string): Promise<void> {
  if (!CONFIG.LINE_TOKEN || !CONFIG.LINE_TO) {
    logger.debug('LINE 未設定: 通知をスキップ');
    return;
  }
  try {
    await axios.post(
      LINE_PUSH_URL,
      { to: CONFIG.LINE_TO, messages: [{ type: 'text', text }] },
      {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CONFIG.LINE_TOKEN}` },
        timeout: 10000,
      },
    );
    logger.info('LINE 通知送信完了');
  } catch (err) {
    if (axios.isAxiosError(err)) {
      logger.error(`LINE 送信エラー: ${err.response?.status} ${JSON.stringify(err.response?.data)}`);
    } else {
      logger.error('LINE 送信エラー:', err);
    }
  }
}

/** シグナル発生通知 */
export async function notifySignal(
  symbol: string,
  date: string,
  reason: string,
  price: number,
): Promise<void> {
  await push(
    `📡 シグナル発生 (${date})\n` +
    `${symbol} BUY @ ~$${price.toFixed(2)}\n` +
    `理由: ${reason}`,
  );
}

/** 約定通知 */
export async function notifyFill(
  symbol: string,
  side: 'BUY' | 'SELL',
  qty: number,
  price: number,
  pnl?: number,
): Promise<void> {
  const pnlStr = pnl !== undefined ? ` | PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}` : '';
  const emoji  = side === 'BUY' ? '🟢' : '🔴';
  await push(`${emoji} 約定: ${side} ${symbol} ×${qty} @ $${price.toFixed(2)}${pnlStr}`);
}

/** 日次サマリー通知 */
export async function notifyDailySummary(opts: {
  date: string;
  equity: number;
  dailyPnl: number;
  openPositions: number;
  filled: string[];
  exited: string[];
  signals: string[];
}): Promise<void> {
  const sign = opts.dailyPnl >= 0 ? '+' : '';
  const lines = [
    `📊 日次サマリー (${opts.date})`,
    `─────────────────────`,
    `💰 資産: $${opts.equity.toFixed(2)}`,
    `📈 本日: ${sign}$${opts.dailyPnl.toFixed(2)}`,
    `📦 保有: ${opts.openPositions}銘柄`,
    opts.filled.length  > 0 ? `✅ 約定: ${opts.filled.join(', ')}` : null,
    opts.exited.length  > 0 ? `🔚 決済: ${opts.exited.join(', ')}`  : null,
    opts.signals.length > 0 ? `📡 シグナル: ${opts.signals.join(', ')}` : null,
  ].filter(Boolean).join('\n');
  await push(lines);
}

/** レポート生成完了通知 */
export async function notifyReport(date: string, preview: string): Promise<void> {
  const msg = `📄 日次レポート (${date})\n\n${preview.slice(0, 1800)}${preview.length > 1800 ? '\n...(続きは reports/ フォルダ)' : ''}`;
  await push(msg);
}

/** Kill Switch 発動通知 */
export async function notifyKillSwitch(reason: string): Promise<void> {
  await push(`🚨 Kill Switch 発動\n${reason}\n取引停止。手動で解除してください。`);
}

/** エラー通知 */
export async function notifyError(msg: string): Promise<void> {
  await push(`❌ エラー: ${msg}`);
}
