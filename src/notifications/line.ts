/**
 * LINE Messaging API 通知
 * LINE_CHANNEL_ACCESS_TOKEN と LINE_TO が設定されている場合のみ送信
 */
import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const LINE_API_URL = 'https://api.line.me/v2/bot/message/push';

export async function sendLineMessage(text: string): Promise<void> {
  if (!config.lineChannelAccessToken || !config.lineTo) {
    logger.warn('LINE設定なし: 通知をスキップします (LINE_CHANNEL_ACCESS_TOKEN / LINE_TO を .env に設定してください)');
    return;
  }

  try {
    await axios.post(
      LINE_API_URL,
      {
        to:       config.lineTo,
        messages: [{ type: 'text', text }],
      },
      {
        headers: {
          'Content-Type':  'application/json',
          Authorization: `Bearer ${config.lineChannelAccessToken}`,
        },
        timeout: 10000,
      },
    );
    logger.info('LINE 通知を送信しました');
  } catch (err) {
    if (axios.isAxiosError(err)) {
      logger.error(`LINE 送信エラー: ${err.response?.status} ${JSON.stringify(err.response?.data)}`);
    } else {
      logger.error('LINE 送信エラー:', err);
    }
  }
}

/** 取引サマリー通知 */
export async function notifyTradeSummary(opts: {
  date: string;
  entered: string[];
  exited: string[];
  todayPnl: number;
  todayPnlPct: number;
  currentEquity: number;
  openPositions: number;
}): Promise<void> {
  const sign = opts.todayPnl >= 0 ? '+' : '';
  const lines = [
    `📊 TradeBot 日次レポート (${opts.date})`,
    `─────────────────────`,
    `💰 資産残高: $${opts.currentEquity.toFixed(2)}`,
    `📈 本日損益: ${sign}$${opts.todayPnl.toFixed(2)} (${sign}${(opts.todayPnlPct * 100).toFixed(2)}%)`,
    `📦 保有ポジション: ${opts.openPositions}`,
    opts.entered.length > 0 ? `🟢 新規エントリー: ${opts.entered.join(', ')}` : null,
    opts.exited.length  > 0 ? `🔴 クローズ: ${opts.exited.join(', ')}`         : null,
  ].filter(Boolean).join('\n');

  await sendLineMessage(lines);
}

/** Kill Switch 発動通知 */
export async function notifyKillSwitch(reason: string): Promise<void> {
  await sendLineMessage(`🚨 Kill Switch 発動\n${reason}\n取引を停止しました。手動で解除してください。`);
}

/** エラー通知 */
export async function notifyError(message: string): Promise<void> {
  await sendLineMessage(`❌ エラー発生\n${message}`);
}
