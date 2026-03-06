/**
 * 全設定値の一元管理 (v1.1)
 * 環境変数 → デフォルト値 の優先順位で読み込む
 * 他モジュールは必ずここから参照する
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
  DB_PATH:           env('DB_PATH', './data/tradebot.db'),

  // ─── Data Provider ────────────────────────────────────────────────────────
  DATA_PROVIDER:     env('DATA_PROVIDER', 'yahoo'),
  ALPHA_VANTAGE_KEY: env('ALPHA_VANTAGE_API_KEY'),

  // ─── Benchmark / Regime シンボル ──────────────────────────────────────────
  BENCHMARK:  'QQQ',   // レジームフィルター: SMA50/SMA200 判定
  SPY_SYMBOL: 'SPY',   // レジームフィルター: close > SMA200 判定（v1.1追加）
  VIX_SYMBOL: '^VIX',  // レジームフィルター: close < VIX_MAX 判定（取得失敗時スキップ）

  // ─── Strategy ─────────────────────────────────────────────────────────────
  LOOKBACK:    20,   // 高値・出来高の参照期間（日）
  VOLUME_MULT: 2.0,  // 出来高急増の閾値倍率（2 = 20日平均の2倍以上）

  // ATR ブレイク条件（ダマシ削減）v1.1追加
  // ENABLE_ATR_BREAKOUT=true の場合: close > highest20 + ATR_MULT × ATR(ATR_PERIOD)
  ENABLE_ATR_BREAKOUT: envBool('ENABLE_ATR_BREAKOUT', true),
  ATR_PERIOD:          envInt('ATR_PERIOD', 14),
  ATR_MULT:            envFloat('ATR_MULT', 0.5),

  // ─── Exit ─────────────────────────────────────────────────────────────────
  STOP_LOSS_PCT:        0.02,   // ストップロス -2%
  TAKE_PROFIT_PCT:      0.04,   // テイクプロフィット +4%
  TRAILING_STOP_ENABLED: envBool('TRAILING_STOP_ENABLED', true),
  ENABLE_TRAILING_STOP:  envBool('TRAILING_STOP_ENABLED', true),  // alias
  TRAILING_STOP_PCT:    0.02,   // トレイリングストップ -2%

  // ─── Execution ────────────────────────────────────────────────────────────
  SLIPPAGE_PCT: 0.001,  // スリッページ 0.1%

  // ─── Filters ──────────────────────────────────────────────────────────────
  MIN_PRICE:       10,         // 最低株価 (USD)
  MIN_AVG_VOLUME:  1_000_000,  // 20日平均出来高 100万株以上
  SMA_FAST:        50,         // 短期 SMA 期間（QQQ 判定）
  SMA_SLOW:        200,        // 長期 SMA 期間（QQQ/SPY 判定）
  EARNINGS_BUFFER: 1,          // 決算前後の除外営業日数

  // VIX フィルター（VIX >= VIX_MAX で新規エントリー停止）v1.1追加
  VIX_MAX: envFloat('VIX_MAX', 25),

  // ─── Risk Engine ──────────────────────────────────────────────────────────
  MAX_POSITIONS:      2,
  MAX_DAILY_LOSS_PCT: 0.03,    // 日次損失上限 3%
  MAX_POSITION_USD:   envFloat('MAX_POSITION_USD', 1000),
  RISK_PER_TRADE_PCT: 0.01,    // 1トレード最大リスク equity の 1%
  CONSEC_LOSS_LIMIT:  3,       // 連続損失上限
  COOLDOWN_HOURS:     48,      // クールダウン時間

  // ─── Capital ──────────────────────────────────────────────────────────────
  INITIAL_EQUITY: envFloat('INITIAL_EQUITY', 10000),

  // ─── Notifications ────────────────────────────────────────────────────────
  LINE_TOKEN: env('LINE_CHANNEL_ACCESS_TOKEN'),
  LINE_TO:    env('LINE_TO'),

  // ─── AI Report ────────────────────────────────────────────────────────────
  OPENAI_KEY:   env('OPENAI_API_KEY'),
  OPENAI_MODEL: env('OPENAI_MODEL', 'gpt-4o-mini'),

  // ─── Misc ─────────────────────────────────────────────────────────────────
  LOG_LEVEL: env('LOG_LEVEL', 'info'),
} as const;
