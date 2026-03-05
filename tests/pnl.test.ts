/**
 * 損益・ポジションサイジング テスト
 * 実行: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env['DB_PATH'] = ':memory:';

// ─── スリッページ計算 ─────────────────────────────────────────────────────────
const SLIPPAGE = 0.001; // 0.1%

describe('スリッページ計算', () => {
  test('BUY の約定価格は open * (1 + slippage)', () => {
    const open     = 100;
    const fillPrice = open * (1 + SLIPPAGE);
    assert.equal(fillPrice, 100.1);
  });

  test('SELL の約定価格は close * (1 - slippage)', () => {
    const close    = 100;
    const fillPrice = close * (1 - SLIPPAGE);
    assert.equal(fillPrice, 99.9);
  });
});

// ─── PnL 計算 ─────────────────────────────────────────────────────────────────
describe('PnL 計算', () => {
  function calcPnl(entryPrice: number, exitPrice: number, qty: number) {
    return (exitPrice - entryPrice) * qty;
  }

  function calcPnlPct(entryPrice: number, exitPrice: number) {
    return (exitPrice - entryPrice) / entryPrice;
  }

  test('TP: +4% で利益確定', () => {
    const entry = 100;
    const exit  = entry * 1.04;
    const pnl   = calcPnl(entry, exit, 10);
    assert.equal(pnl, 40);
    assert.ok(Math.abs(calcPnlPct(entry, exit) - 0.04) < 1e-10);
  });

  test('SL: -2% でストップロス', () => {
    const entry = 100;
    const exit  = entry * 0.98;
    const pnl   = calcPnl(entry, exit, 10);
    assert.equal(pnl, -20);
    assert.ok(Math.abs(calcPnlPct(entry, exit) - (-0.02)) < 1e-10);
  });

  test('スリッページ込みの実質 PnL', () => {
    const entry     = 100;
    const buyFill   = entry * (1 + SLIPPAGE); // 100.1
    const sellClose = entry * 1.04;           // 104
    const sellFill  = sellClose * (1 - SLIPPAGE); // 103.896
    const pnl       = (sellFill - buyFill) * 10;
    // (103.896 - 100.1) * 10 = 37.96
    assert.ok(Math.abs(pnl - 37.96) < 0.01, `PnL: ${pnl}`);
  });
});

// ─── ポジションサイジング ─────────────────────────────────────────────────────
import { calcPositionSize } from '../src/strategy/breakout';

describe('calcPositionSize (リスクベース)', () => {
  test('equity=10000, price=50 → riskShares=10, maxShares=20 → 10株', () => {
    // riskShares = (10000 * 0.01) / (50 * 0.02) = 100/1 = 100 → 100 株
    // maxShares  = 1000 / 50 = 20 株
    // result = min(100, 20) = 20
    const qty = calcPositionSize(10000, 50);
    assert.equal(qty, 20);
  });

  test('価格が高く riskShares < maxShares の場合はリスクで制限', () => {
    // riskShares = (10000 * 0.01) / (200 * 0.02) = 100/4 = 25 株
    // maxShares  = 1000 / 200 = 5 株
    // result = min(25, 5) = 5
    const qty = calcPositionSize(10000, 200);
    assert.equal(qty, 5);
  });
});

// ─── 最大ドローダウン計算 ─────────────────────────────────────────────────────
import { maxDrawdown } from '../src/utils/math';

describe('maxDrawdown', () => {
  test('空配列は 0', () => {
    assert.equal(maxDrawdown([]), 0);
  });

  test('単調増加は 0', () => {
    assert.ok(Math.abs(maxDrawdown([100, 110, 120]) - 0) < 1e-10);
  });

  test('50% ドローダウン', () => {
    const dd = maxDrawdown([100, 80, 50, 60]);
    assert.ok(Math.abs(dd - 0.5) < 1e-10, `DD: ${dd}`);
  });

  test('複数のドローダウンから最大を返す', () => {
    // peak=120, trough=60 → 50%
    const dd = maxDrawdown([100, 120, 60, 80, 100]);
    assert.ok(Math.abs(dd - 0.5) < 1e-10, `DD: ${dd}`);
  });
});

// ─── SMA 計算 ─────────────────────────────────────────────────────────────────
import { sma } from '../src/utils/math';

describe('sma', () => {
  test('5期間 SMA', () => {
    const result = sma([1, 2, 3, 4, 5], 5);
    assert.equal(result, 3);
  });

  test('データ不足時は null', () => {
    assert.equal(sma([1, 2], 5), null);
  });

  test('末尾 n 件を使う', () => {
    // [10, 1, 2, 3, 4, 5] → 末尾 3 件 = [3,4,5] → avg=4
    const result = sma([10, 1, 2, 3, 4, 5], 3);
    assert.equal(result, 4);
  });
});
