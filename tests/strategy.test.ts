/**
 * strategy テスト
 * 実行: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// テスト対象のモジュールを直接インポート（DB 不要な純粋関数のみ）
// CONFIG をモック化するために process.env を先に設定
process.env['DB_PATH'] = ':memory:';
process.env['DATA_PROVIDER'] = 'mock';

// ─── テスト用ヘルパー ─────────────────────────────────────────────────────────
import type { PriceRow } from '../src/db/prices';
import { evaluateBreakout, calcPositionSize } from '../src/strategy/breakout';
import { liquidityFilter, marketRegimeFilter } from '../src/strategy/filters';

function makeBar(overrides: Partial<PriceRow> & { date: string }): PriceRow {
  return {
    symbol: overrides.symbol ?? 'TEST',
    date:   overrides.date,
    open:   overrides.open  ?? 100,
    high:   overrides.high  ?? 105,
    low:    overrides.low   ?? 95,
    close:  overrides.close ?? 100,
    volume: overrides.volume ?? 2_000_000,
  };
}

/** lookback 日分の横ばいバーを生成 */
function flatBars(symbol: string, n: number, price: number, volume: number): PriceRow[] {
  return Array.from({ length: n }, (_, i) => ({
    symbol,
    date:   `2024-01-${String(i + 1).padStart(2, '0')}`,
    open:   price,
    high:   price,
    low:    price,
    close:  price,
    volume,
  }));
}

// ─── breakout.ts ─────────────────────────────────────────────────────────────

describe('evaluateBreakout', () => {
  test('データ不足時は null を返す', () => {
    const bars = flatBars('AAPL', 5, 100, 2_000_000); // lookback(20) 未満
    const result = evaluateBreakout(bars);
    assert.equal(result, null);
  });

  test('高値ブレイク + 出来高急増でシグナルを返す', () => {
    // 過去 20 日分の横ばいバー（high=100）+ 今日のブレイクバー
    const history = flatBars('AAPL', 20, 100, 1_000_000);
    const today   = makeBar({ symbol: 'AAPL', date: '2024-02-01', close: 105, high: 106, volume: 3_000_000 });
    const bars    = [...history, today];

    const signal = evaluateBreakout(bars);
    assert.ok(signal !== null, 'シグナルが生成されるべき');
    assert.equal(signal!.action, 'BUY');
    assert.equal(signal!.symbol, 'AAPL');
    assert.ok(signal!.meta.volRatio >= 2);
  });

  test('高値ブレイクしても出来高不足ならシグナルなし', () => {
    const history = flatBars('AAPL', 20, 100, 2_000_000);
    // 高値はブレイクしているが出来高は 1.5x (< 2x)
    const today = makeBar({ date: '2024-02-01', close: 105, high: 106, volume: 2_900_000 });
    const bars  = [...history, today];
    const signal = evaluateBreakout(bars);
    assert.equal(signal, null);
  });

  test('出来高急増しても高値未ブレイクならシグナルなし', () => {
    const history = flatBars('AAPL', 20, 100, 1_000_000);
    // close(99) <= highMax(100) → ブレイクなし
    const today = makeBar({ date: '2024-02-01', close: 99, high: 100, volume: 3_000_000 });
    const bars  = [...history, today];
    const signal = evaluateBreakout(bars);
    assert.equal(signal, null);
  });
});

// ─── calcPositionSize ─────────────────────────────────────────────────────────

describe('calcPositionSize', () => {
  test('equity=10000, price=100 → 正の株数を返す', () => {
    const qty = calcPositionSize(10000, 100);
    assert.ok(qty > 0, `株数は正の値であるべき: ${qty}`);
    // equity*1%/SL = 100 / (100*0.02) = 50 株
    // MAX_POSITION_USD/price = 1000/100 = 10 株 → min(50, 10) = 10
    assert.equal(qty, 10);
  });

  test('price=0 のとき 0 を返す', () => {
    assert.equal(calcPositionSize(10000, 0), 0);
  });

  test('price が非常に高い場合（バジェット上限で制限）', () => {
    const qty = calcPositionSize(10000, 5000); // $5000/株
    assert.equal(qty, 0); // MAX_POSITION_USD($1000) / $5000 = 0.2 → floor = 0
  });
});

// ─── liquidityFilter ─────────────────────────────────────────────────────────

describe('liquidityFilter', () => {
  test('価格 $5 → 不通過（MIN_PRICE=$10）', () => {
    const bars = flatBars('TEST', 20, 5, 2_000_000);
    const result = liquidityFilter(bars);
    assert.equal(result.passed, false);
    assert.ok(result.reason.includes('株価'));
  });

  test('平均出来高 500k → 不通過（MIN_AVG_VOLUME=1M）', () => {
    const bars = flatBars('TEST', 20, 50, 500_000);
    const result = liquidityFilter(bars);
    assert.equal(result.passed, false);
    assert.ok(result.reason.includes('平均出来高'));
  });

  test('価格 $50, 出来高 2M → 通過', () => {
    const bars = flatBars('TEST', 20, 50, 2_000_000);
    const result = liquidityFilter(bars);
    assert.equal(result.passed, true);
  });

  test('データ空 → 不通過', () => {
    const result = liquidityFilter([]);
    assert.equal(result.passed, false);
  });
});

// ─── marketRegimeFilter ───────────────────────────────────────────────────────

describe('marketRegimeFilter', () => {
  test('データ不足時は不通過', () => {
    const bars = flatBars('QQQ', 100, 450, 5_000_000); // SMA200 未満
    const result = marketRegimeFilter(bars);
    assert.equal(result.passed, false);
    assert.ok(result.reason.includes('データ不足'));
  });

  test('SMA50 > SMA200 かつ close > SMA200 → 通過', () => {
    // 強い上昇トレンド: 徐々に価格を上げる 210 件のバー
    const bars: PriceRow[] = Array.from({ length: 210 }, (_, i) => ({
      symbol: 'QQQ',
      date:   `2023-${String(Math.floor(i / 30) + 1).padStart(2, '0')}-${String((i % 30) + 1).padStart(2, '0')}`,
      open:   300 + i,
      high:   301 + i,
      low:    299 + i,
      close:  300 + i,  // 単調増加
      volume: 5_000_000,
    }));
    const result = marketRegimeFilter(bars);
    assert.equal(result.passed, true, `期待: pass, 実際: ${result.reason}`);
  });

  test('下降トレンド → 不通過', () => {
    const bars: PriceRow[] = Array.from({ length: 210 }, (_, i) => ({
      symbol: 'QQQ',
      date:   `2023-01-${String(i + 1).padStart(3, '0')}`,
      open:   500 - i,
      high:   501 - i,
      low:    499 - i,
      close:  500 - i,  // 単調減少
      volume: 5_000_000,
    }));
    const result = marketRegimeFilter(bars);
    assert.equal(result.passed, false);
  });
});
