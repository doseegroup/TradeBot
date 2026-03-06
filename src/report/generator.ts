/**
 * 日次レポート生成 (v1.1)
 * - OPENAI_API_KEY があれば AI 要約、なければテンプレート
 * - Regime 判定結果（QQQ/SPY/VIX）・スキップ数・連敗数・クールダウンを追加
 * - reports/YYYY-MM-DD.md に保存 + daily_reports テーブルにも保存
 */
import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config/index';
import { logger } from '../utils/logger';
import { upsertReport } from '../db/reports';
import { getOrdersByDate, getFillsByOrderId } from '../db/orders';
import { getSignalsByDate } from '../db/signals';
import { getEquityHistory } from '../db/equity';
import { getAllPositions } from '../db/positions';
import { getDailyRunContext, getConsecLosses, isCooldownActive, getCooldownUntil } from '../db/system';
import { maxDrawdown } from '../utils/math';

const REPORTS_DIR = path.join(process.cwd(), 'reports');

// ─── サマリーデータ収集 ───────────────────────────────────────────────────────

interface DaySummary {
  date: string;
  signals:  ReturnType<typeof getSignalsByDate>;
  orders:   ReturnType<typeof getOrdersByDate>;
  fills:    Array<{ orderId: string; price: number; qty: number }>;
  positions: ReturnType<typeof getAllPositions>;
  equityHistory: ReturnType<typeof getEquityHistory>;
  maxDD: number;
  currentEquity: number;
  dailyPnl: number;
  // v1.1: 追加フィールド
  runCtx: {
    regime: {
      passed: boolean;
      reason: string;
      details?: {
        qqq: { close: number; sma50: number; sma200: number; passed: boolean } | null;
        spy: { close: number; sma200: number; passed: boolean } | null;
        vix: { close: number; passed: boolean } | null;
        vixSkipped: boolean;
      };
    } | null;
    skippedByFilters: number;
    consecLosses: number;
    cooldownActive: boolean;
    cooldownUntil: string | null;
  };
}

function collectSummary(date: string): DaySummary {
  const signals    = getSignalsByDate(date);
  const orders     = getOrdersByDate(date);
  const equityHist = getEquityHistory(30);
  const positions  = getAllPositions();
  const fills: DaySummary['fills'] = [];

  for (const order of orders) {
    const f = getFillsByOrderId(order.id);
    for (const fill of f) {
      fills.push({ orderId: order.id, price: fill.price, qty: fill.qty });
    }
  }

  const equities = equityHist.map((e) => e.equity);
  const maxDD    = maxDrawdown(equities) * 100;
  const current  = equityHist[equityHist.length - 1]?.equity ?? CONFIG.INITIAL_EQUITY;
  const prev     = equityHist[equityHist.length - 2]?.equity ?? CONFIG.INITIAL_EQUITY;
  const dailyPnl = current - prev;

  // 日次実行コンテキスト（run.ts が保存した値。なければ現在の状態を参照）
  const storedCtx = getDailyRunContext(date);
  const runCtx: DaySummary['runCtx'] = storedCtx ?? {
    regime:          null,
    skippedByFilters: 0,
    consecLosses:    getConsecLosses(),
    cooldownActive:  isCooldownActive(),
    cooldownUntil:   getCooldownUntil(),
  };

  return { date, signals, orders, fills, positions, equityHistory: equityHist, maxDD, currentEquity: current, dailyPnl, runCtx };
}

// ─── Regime セクション生成（テンプレート用）─────────────────────────────────

function regimeSection(runCtx: DaySummary['runCtx']): string {
  const regime = runCtx.regime;
  if (!regime) return '> 本日のレジーム判定データなし（手動レポート実行の可能性）';

  const icon   = regime.passed ? '🟢' : '🔴';
  const result = regime.passed ? '通過' : '不通過';
  const lines  = [`${icon} **レジームフィルター: ${result}**`, `> ${regime.reason}`];

  const d = regime.details;
  if (d) {
    if (d.qqq) {
      const q = d.qqq;
      lines.push(`- QQQ: close=${q.close.toFixed(2)}, SMA50=${q.sma50.toFixed(2)}, SMA200=${q.sma200.toFixed(2)} → ${q.passed ? '✅' : '❌'}`);
    }
    if (d.spy) {
      lines.push(`- SPY: close=${d.spy.close.toFixed(2)}, SMA200=${d.spy.sma200.toFixed(2)} → ${d.spy.passed ? '✅' : '❌'}`);
    }
    if (d.vixSkipped) {
      lines.push('- VIX: データ取得失敗 → スキップ（⚠️ 継続）');
    } else if (d.vix) {
      lines.push(`- VIX: ${d.vix.close.toFixed(1)} → ${d.vix.passed ? `✅ <${CONFIG.VIX_MAX}` : `❌ ≥${CONFIG.VIX_MAX}`}`);
    }
  }
  return lines.join('\n');
}

// ─── テンプレートレポート ─────────────────────────────────────────────────────

function templateReport(s: DaySummary): string {
  const sellOrders    = s.orders.filter((o) => o.side === 'SELL');
  const buyOrders     = s.orders.filter((o) => o.side === 'BUY');
  const sign          = s.dailyPnl >= 0 ? '+' : '';
  const closedSignals = s.signals.filter((sig) => sig.action === 'SELL');
  const wins   = closedSignals.filter((sig) => { const m = JSON.parse(sig.meta_json ?? '{}'); return (m.pnl ?? 0) > 0; });
  const losses = closedSignals.filter((sig) => { const m = JSON.parse(sig.meta_json ?? '{}'); return (m.pnl ?? 0) <= 0; });

  const ctx = s.runCtx;
  const cooldownStr = ctx.cooldownActive
    ? `発動中（解除: ${ctx.cooldownUntil ?? '不明'}）`
    : 'なし';

  return `# 📊 TradeBot 日次レポート ${s.date}

> AIなしレポート（テンプレートベース）

## 1. 本日のサマリー

| 項目 | 値 |
|------|-----|
| 日付 | ${s.date} |
| 資産残高 | $${s.currentEquity.toFixed(2)} |
| 本日損益 | ${sign}$${s.dailyPnl.toFixed(2)} |
| 最大ドローダウン(30日) | ${s.maxDD.toFixed(2)}% |
| 連敗数 | ${ctx.consecLosses}回 |
| クールダウン | ${cooldownStr} |
| シグナル数（BUY） | ${s.signals.filter((sg) => sg.action === 'BUY').length} |
| フィルタースキップ数 | ${ctx.skippedByFilters}銘柄 |
| 買い注文 | ${buyOrders.length} |
| 売り注文 | ${sellOrders.length} |
| 勝ちトレード | ${wins.length} |
| 負けトレード | ${losses.length} |

## 2. 市場レジーム判定（QQQ / SPY / VIX）

${regimeSection(ctx)}

## 3. 取引詳細

${closedSignals.length === 0
  ? '本日のクローズ取引なし'
  : closedSignals.map((sig) => {
    const m = JSON.parse(sig.meta_json ?? '{}') as { pnl?: number; pnlPct?: number };
    const pnl = m.pnl ?? 0;
    const s2 = pnl >= 0 ? '+' : '';
    return `- **${sig.symbol}** [${sig.reason}]: ${s2}$${pnl.toFixed(2)} (${s2}${((m.pnlPct ?? 0) * 100).toFixed(2)}%)`;
  }).join('\n')
}

## 4. 保有ポジション (${s.positions.length}件)

${s.positions.length === 0
  ? 'なし'
  : s.positions.map((p) =>
    `- **${p.symbol}**: ×${p.qty} @ $${p.avg_price.toFixed(2)} | SL: $${(p.stop_loss ?? 0).toFixed(2)} TP: $${(p.take_profit ?? 0).toFixed(2)}`
  ).join('\n')
}

## 5. 勝敗の要因分析

${wins.length > 0
  ? `**勝ちパターン**: ${wins.map((sg) => `${sg.symbol}(${sg.reason})`).join(', ')}`
  : '勝ちトレードなし'
}

${losses.length > 0
  ? `**負けパターン**: ${losses.map((sg) => `${sg.symbol}(${sg.reason})`).join(', ')}`
  : '負けトレードなし'
}

## 6. 改善案

- 流動性フィルターの閾値（現在: avg_volume > 1M）を見直す
- ATR倍率（現在: ATR_MULT=${CONFIG.ATR_MULT}）を市場環境に応じて調整する
- ストップロス幅（現在: -${(CONFIG.STOP_LOSS_PCT * 100).toFixed(0)}%）のボラティリティベース化を検討

## 7. 明日やること

- [ ] 全銘柄のデータフェッチ確認
- [ ] 保有ポジションのリスク評価
- [ ] QQQ/SPY のトレンド確認（市場レジームフィルター）
- [ ] VIX 水準の確認（現在の閾値: ${CONFIG.VIX_MAX}）
`;
}

// ─── AI レポート ──────────────────────────────────────────────────────────────

async function aiReport(s: DaySummary): Promise<string> {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: CONFIG.OPENAI_KEY });

  const ctx = s.runCtx;
  const regime = ctx.regime;
  const regimeStr = regime
    ? `${regime.passed ? '通過' : '不通過'} - ${regime.reason}`
    : 'データなし';

  const prompt = `
あなたは米株ペーパートレードボットのアナリストです。以下のデータを分析して、日次レポートを日本語の Markdown で生成してください。

## データ（${s.date}）

### 資産状況
- 資産残高: $${s.currentEquity.toFixed(2)}
- 本日損益: ${s.dailyPnl >= 0 ? '+' : ''}$${s.dailyPnl.toFixed(2)}
- 最大ドローダウン(30日): ${s.maxDD.toFixed(2)}%
- 連敗数: ${ctx.consecLosses}回
- クールダウン: ${ctx.cooldownActive ? `発動中（解除: ${ctx.cooldownUntil}）` : 'なし'}

### 市場レジーム（QQQ / SPY / VIX）
- 判定結果: ${regimeStr}
${regime?.details?.qqq ? `- QQQ: close=${regime.details.qqq.close.toFixed(2)}, SMA50=${regime.details.qqq.sma50.toFixed(2)}, SMA200=${regime.details.qqq.sma200.toFixed(2)}` : ''}
${regime?.details?.spy ? `- SPY: close=${regime.details.spy.close.toFixed(2)}, SMA200=${regime.details.spy.sma200.toFixed(2)}` : ''}
${regime?.details?.vixSkipped ? '- VIX: データなし（スキップ）' : regime?.details?.vix ? `- VIX: ${regime.details.vix.close.toFixed(1)}（閾値: ${CONFIG.VIX_MAX}）` : ''}

### シグナル・取引
- BUY シグナル: ${JSON.stringify(s.signals.filter((sg) => sg.action === 'BUY').map((sg) => ({ symbol: sg.symbol, reason: sg.reason })))}
- フィルタースキップ: ${ctx.skippedByFilters}銘柄
- 決済: ${JSON.stringify(s.signals.filter((sg) => sg.action === 'SELL').map((sg) => ({ symbol: sg.symbol, reason: sg.reason, meta: JSON.parse(sg.meta_json ?? '{}') })))}
- 保有中: ${JSON.stringify(s.positions.map((p) => ({ symbol: p.symbol, qty: p.qty, avgPrice: p.avg_price })))}

## 必須構成

1. 本日のサマリー（表形式: 資産・損益・レジーム・連敗・DD）
2. 市場レジーム詳細（QQQ/SPY/VIX の各判定と市場解釈）
3. 取引詳細と勝敗理由の分析
4. リスク評価（DD・連敗・クールダウン状況）
5. 具体的な改善案（3点以上、コード修正観点）
6. 明日の行動計画

注意: 売買シグナルや具体的な銘柄への投資アドバイスは出さない。要約・分析のみ。
`.trim();

  logger.info('OpenAI でレポート生成中...');
  const res = await client.chat.completions.create({
    model:      CONFIG.OPENAI_MODEL,
    messages:   [{ role: 'user', content: prompt }],
    max_tokens: 2500,
  });

  return `# 📊 TradeBot 日次レポート ${s.date}\n\n> AI生成 (${CONFIG.OPENAI_MODEL})\n\n` +
    (res.choices[0]?.message.content ?? '(AI応答なし)') +
    '\n\n---\n*Generated by TradeBot AI Reporter v1.1*\n';
}

// ─── メイン関数 ───────────────────────────────────────────────────────────────

export async function generateReport(date: string): Promise<string> {
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

  const summary = collectSummary(date);

  let content: string;
  if (CONFIG.OPENAI_KEY) {
    try {
      content = await aiReport(summary);
    } catch (err) {
      logger.error('AI レポート生成失敗、テンプレートに切り替え:', err);
      content = templateReport(summary);
    }
  } else {
    content = templateReport(summary);
  }

  const filePath = path.join(REPORTS_DIR, `${date}.md`);
  fs.writeFileSync(filePath, content, 'utf-8');
  upsertReport(date, content);
  logger.info(`レポート保存: ${filePath}`);
  return content;
}
