/**
 * npm run export
 * 取引ログを CSV にエクスポートする
 * 出力: exports/trades-YYYY-MM-DD.csv
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { runMigrations } from '../db/schema.js';
import { getAllTrades, getAllOrders } from '../db/queries.js';
import { logger } from '../utils/logger.js';
import { toDateString } from '../providers/base.js';

const EXPORTS_DIR = path.join(process.cwd(), 'exports');

function escapeCsv(value: string | number | undefined): string {
  const s = String(value ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsvRow(values: (string | number | undefined)[]): string {
  return values.map(escapeCsv).join(',');
}

async function main(): Promise<void> {
  runMigrations();
  if (!fs.existsSync(EXPORTS_DIR)) fs.mkdirSync(EXPORTS_DIR, { recursive: true });

  const today = toDateString(new Date());

  // ─── trades.csv ──────────────────────────────────────────────────────────────
  const trades = getAllTrades();
  const tradesHeader = ['id', 'symbol', 'entry_date', 'exit_date', 'entry_price', 'exit_price', 'quantity', 'pnl', 'pnl_pct', 'reason'];
  const tradesRows = trades.map((t) => toCsvRow([
    t.id, t.symbol, t.entryDate, t.exitDate,
    t.entryPrice.toFixed(4), t.exitPrice.toFixed(4),
    t.quantity, t.pnl.toFixed(4), (t.pnlPct * 100).toFixed(4), t.reason,
  ]));
  const tradesCsv = [tradesHeader.join(','), ...tradesRows].join('\n');
  const tradesPath = path.join(EXPORTS_DIR, `trades-${today}.csv`);
  fs.writeFileSync(tradesPath, tradesCsv, 'utf-8');
  logger.info(`取引履歴エクスポート: ${tradesPath} (${trades.length} 件)`);

  // ─── orders.csv ──────────────────────────────────────────────────────────────
  const orders = getAllOrders();
  const ordersHeader = ['id', 'symbol', 'date', 'type', 'quantity', 'price', 'status', 'reason'];
  const ordersRows = orders.map((o) => toCsvRow([
    o.id, o.symbol, o.date, o.type,
    o.quantity, o.price.toFixed(4), o.status, o.reason,
  ]));
  const ordersCsv = [ordersHeader.join(','), ...ordersRows].join('\n');
  const ordersPath = path.join(EXPORTS_DIR, `orders-${today}.csv`);
  fs.writeFileSync(ordersPath, ordersCsv, 'utf-8');
  logger.info(`注文履歴エクスポート: ${ordersPath} (${orders.length} 件)`);

  // サマリー表示
  const totalPnl  = trades.reduce((s, t) => s + t.pnl, 0);
  const wins      = trades.filter((t) => t.pnl > 0).length;
  const winRate   = trades.length > 0 ? (wins / trades.length) * 100 : 0;
  logger.info(`総損益: ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)} | 勝率: ${winRate.toFixed(1)}% (${wins}/${trades.length})`);
}

main().catch((err) => {
  logger.error('exportコマンド 致命的エラー:', err);
  process.exit(1);
});
