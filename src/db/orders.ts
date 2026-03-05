/** orders + fills テーブルの操作 */
import { getDb } from './client';
import { randomUUID } from 'crypto';

export type OrderStatus = 'PENDING' | 'FILLED' | 'CANCELLED';
export type OrderSide   = 'BUY' | 'SELL';

export interface OrderRow {
  id: string;
  date: string;
  symbol: string;
  side: OrderSide;
  qty: number;
  price: number;
  status: OrderStatus;
}

export interface FillRow {
  id: string;
  order_id: string;
  date: string;
  price: number;
  qty: number;
}

// ─── Orders ───────────────────────────────────────────────────────────────────

export function insertOrder(order: Omit<OrderRow, 'id'>): string {
  const id = randomUUID();
  getDb().prepare(`
    INSERT INTO orders (id, date, symbol, side, qty, price, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, order.date, order.symbol, order.side, order.qty, order.price, order.status);
  return id;
}

export function updateOrderStatus(id: string, status: OrderStatus): void {
  getDb().prepare('UPDATE orders SET status=? WHERE id=?').run(status, id);
}

export function getPendingOrders(): OrderRow[] {
  return getDb()
    .prepare<[], OrderRow>("SELECT * FROM orders WHERE status='PENDING' ORDER BY date ASC")
    .all();
}

export function getOrdersByDate(date: string): OrderRow[] {
  return getDb()
    .prepare<[string], OrderRow>('SELECT * FROM orders WHERE date=? ORDER BY rowid ASC')
    .all(date);
}

export function getAllOrders(): OrderRow[] {
  return getDb()
    .prepare<[], OrderRow>('SELECT * FROM orders ORDER BY date ASC, rowid ASC')
    .all();
}

// ─── Fills ────────────────────────────────────────────────────────────────────

export function insertFill(fill: Omit<FillRow, 'id'>): string {
  const id = randomUUID();
  getDb().prepare(`
    INSERT INTO fills (id, order_id, date, price, qty)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, fill.order_id, fill.date, fill.price, fill.qty);
  return id;
}

export function getFillsByOrderId(orderId: string): FillRow[] {
  return getDb()
    .prepare<[string], FillRow>('SELECT * FROM fills WHERE order_id=?')
    .all(orderId);
}

export function getAllFills(): FillRow[] {
  return getDb()
    .prepare<[], FillRow>('SELECT * FROM fills ORDER BY date ASC')
    .all();
}
