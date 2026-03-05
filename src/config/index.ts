/**
 * 戦略パラメータ・設定値の一元管理
 * すべての設定はここから読み込む。
 */
import 'dotenv/config';

function env(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

function envFloat(key: string, fallback: number): number {
  const v = process.env[key];
  const n = v ? parseFloat(v) : NaN;
  return isNaN(n) ? fallback : n;
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  const n = v ? parseInt(v, 10) : NaN;
  return isNaN(n) ? fallback : n;
}

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (!v) return fallback;
  return v.toLowerCase() === 'true';
}

export const CONFIG = {
  // ─── Database ─────────────────────────────────────────────────────────────
  DB_PATH:          env('DB_PATH', './data/tradebot.db'),

  // ─── Data Provider ────────────────────────────────────────────────────────
  DATA_PROVIDER:    env('DATA_PROVIDER', 'yahoo'),
  ALPHA_VANTAGE_KEY: env('ALPHA_VANTAGE_API_KEY'),

  // ─── Strategy ─────────────────────────────────────────────────────────────
  LOOKBACK:         20,         // 20日間の参照期間
  VOLUME_MULT:      2,          // 出来高急増の倍率

  // ─── Exit ─────────────────────────────────────────────────────────────────
  STOP_LOSS_PCT:    0.02,       // ストップロス 2%
  TAKE_PROFIT_PCT:  0.04,       // テイクプロフィット 4%
  TRAILING_STOP_ENABLED: envBool('TRAILING_STOP_ENABLED', true),
  TRAILING_STOP_PCT: 0.02,      // トレイリングストップ 最高値から2%

  // ─── Execution ────────────────────────────────────────────────────────────
  SLIPPAGE_PCT:     0.001,      // スリッページ 0.1%

  // ─── Liquidity Filter ─────────────────────────────────────────────────────
  MIN_PRICE:        10,         // 最低株価 $10
  MIN_AVG_VOLUME:   1_000_000,  // 20日平均出来高 100万株以上

  // ─── Market Regime Filter（QQQ）────────────────────────────────────────────
  BENCHMARK:        'QQQ',
  SMA_FAST:         50,         // SMA50
  SMA_SLOW:         200,        // SMA200

  // ─── Risk Engine ──────────────────────────────────────────────────────────
  MAX_POSITIONS:    2,
  MAX_DAILY_LOSS_PCT: 0.03,     // 日次最大損失 3%
  MAX_POSITION_USD: envFloat('MAX_POSITION_USD', 1000),
  RISK_PER_TRADE_PCT: 0.01,     // 1トレード最大リスク equity の 1%
  CONSEC_LOSS_LIMIT: 3,         // 連続損失上限
  COOLDOWN_HOURS:   48,         // クールダウン時間

  // ─── Paper Trading ────────────────────────────────────────────────────────
  INITIAL_EQUITY:   envFloat('INITIAL_EQUITY', 10000),

  // ─── Earnings Filter ──────────────────────────────────────────────────────
  EARNINGS_BUFFER:  1,          // 決算前後 N 営業日は取引禁止

  // ─── LINE ─────────────────────────────────────────────────────────────────
  LINE_TOKEN:       env('LINE_CHANNEL_ACCESS_TOKEN'),
  LINE_TO:          env('LINE_TO'),

  // ─── OpenAI ───────────────────────────────────────────────────────────────
  OPENAI_KEY:       env('OPENAI_API_KEY'),
  OPENAI_MODEL:     env('OPENAI_MODEL', 'gpt-4o-mini'),

  // ─── Logging ──────────────────────────────────────────────────────────────
  LOG_LEVEL:        env('LOG_LEVEL', 'info'),
} as const;
