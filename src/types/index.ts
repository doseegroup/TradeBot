// ─── OHLCV ───────────────────────────────────────────────────────────────────
export interface OHLCVBar {
  symbol: string;
  date: string;   // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ─── Signal ───────────────────────────────────────────────────────────────────
export type SignalType = 'BUY' | 'SELL';

export interface Signal {
  symbol: string;
  date: string;
  type: SignalType;
  price: number;
  reason: string;
}

// ─── Order ────────────────────────────────────────────────────────────────────
export type OrderStatus = 'PENDING' | 'FILLED' | 'CANCELLED';

export interface Order {
  id?: number;
  symbol: string;
  date: string;
  type: SignalType;
  quantity: number;
  price: number;
  status: OrderStatus;
  reason: string;
}

// ─── Position ─────────────────────────────────────────────────────────────────
export interface Position {
  id?: number;
  symbol: string;
  quantity: number;
  entryPrice: number;
  entryDate: string;
  highestPrice: number;   // for trailing stop
  stopLoss: number;
  takeProfit: number;
}

// ─── Trade (completed) ────────────────────────────────────────────────────────
export type ExitReason =
  | 'STOP_LOSS'
  | 'TAKE_PROFIT'
  | 'TRAILING_STOP'
  | 'MANUAL'
  | 'RISK_LIMIT';

export interface Trade {
  id?: number;
  symbol: string;
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  pnlPct: number;
  reason: ExitReason;
}

// ─── Daily Risk ───────────────────────────────────────────────────────────────
export interface DailyRisk {
  date: string;
  startingEquity: number;
  currentEquity: number;
  dailyPnl: number;
  dailyPnlPct: number;
  tradeCount: number;
}

// ─── Data Provider Interface ──────────────────────────────────────────────────
export interface IDataProvider {
  fetchDaily(symbol: string, startDate: string, endDate: string): Promise<OHLCVBar[]>;
}

// ─── Config ───────────────────────────────────────────────────────────────────
export interface AppConfig {
  dataProvider: string;
  alphaVantageApiKey: string;
  dbPath: string;
  initialEquity: number;
  positionSizeUsd: number;
  maxPositions: number;
  lookbackDays: number;
  stopLossPct: number;
  takeProfitPct: number;
  trailingStopEnabled: boolean;
  trailingStopPct: number;
  maxDailyLossPct: number;
  maxConsecutiveErrors: number;
  lineChannelAccessToken: string;
  lineTo: string;
  openaiApiKey: string;
  openaiModel: string;
  logLevel: string;
}
