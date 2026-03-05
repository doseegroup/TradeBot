import 'dotenv/config';
import type { AppConfig } from './types/index.js';

function requireEnv(key: string, defaultVal?: string): string {
  const val = process.env[key] ?? defaultVal;
  if (val === undefined) {
    throw new Error(`環境変数 ${key} が設定されていません。.env を確認してください。`);
  }
  return val;
}

function parseFloat_(key: string, defaultVal: number): number {
  const val = process.env[key];
  if (!val) return defaultVal;
  const n = parseFloat(val);
  if (isNaN(n)) throw new Error(`環境変数 ${key} が数値ではありません: ${val}`);
  return n;
}

function parseInt_(key: string, defaultVal: number): number {
  const val = process.env[key];
  if (!val) return defaultVal;
  const n = parseInt(val, 10);
  if (isNaN(n)) throw new Error(`環境変数 ${key} が整数ではありません: ${val}`);
  return n;
}

function parseBool(key: string, defaultVal: boolean): boolean {
  const val = process.env[key];
  if (!val) return defaultVal;
  return val.toLowerCase() === 'true';
}

export const config: AppConfig = {
  dataProvider:          requireEnv('DATA_PROVIDER', 'yahoo'),
  alphaVantageApiKey:    process.env['ALPHA_VANTAGE_API_KEY'] ?? '',
  dbPath:                requireEnv('DB_PATH', './data/tradebot.db'),
  initialEquity:         parseFloat_('INITIAL_EQUITY', 10000),
  positionSizeUsd:       parseFloat_('POSITION_SIZE_USD', 1000),
  maxPositions:          parseInt_('MAX_POSITIONS', 2),
  lookbackDays:          parseInt_('LOOKBACK_DAYS', 20),
  stopLossPct:           parseFloat_('STOP_LOSS_PCT', 0.02),
  takeProfitPct:         parseFloat_('TAKE_PROFIT_PCT', 0.04),
  trailingStopEnabled:   parseBool('TRAILING_STOP_ENABLED', true),
  trailingStopPct:       parseFloat_('TRAILING_STOP_PCT', 0.02),
  maxDailyLossPct:       parseFloat_('MAX_DAILY_LOSS_PCT', 0.03),
  maxConsecutiveErrors:  parseInt_('MAX_CONSECUTIVE_ERRORS', 3),
  lineChannelAccessToken: process.env['LINE_CHANNEL_ACCESS_TOKEN'] ?? '',
  lineTo:                process.env['LINE_TO'] ?? '',
  openaiApiKey:          process.env['OPENAI_API_KEY'] ?? '',
  openaiModel:           requireEnv('OPENAI_MODEL', 'gpt-4o-mini'),
  logLevel:              requireEnv('LOG_LEVEL', 'info'),
};
