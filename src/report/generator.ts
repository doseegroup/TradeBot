/**
 * 日次レポート生成（v2）
 * - OPENAI_API_KEY があれば AI 要約、なければテンプレート
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
import { maxDrawdown } from '../utils/math';

const REPORTS_DIR = path.join(process.cwd(), 'reports');

// ─── サマリーデータ収集 ───────────────────────────────────────────────────────

interface DaySummary {
  date: string;
  signals: ReturnType<typeof getSignalsByDate>;
  orders:  ReturnType<typeof getOrdersByDate>;
  fills:   Array<{ orderId: string; price: number; qty: number }>;
  positions: ReturnType<typeof getAllPositions>;
  equityHistory: ReturnType<typeof getEquityHistory>;
  maxDD: number;
  currentEquity: number;
  dailyPnl: number;
}

function collectSummary(date: string): DaySummary {
  const signals     = getSignalsByDate(date);
  const orders      = getOrdersByDate(date);
  const equityHist  = getEquityHistory(30);
  const positions   = getAllPositions();
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

  return { date, signals, orders, fills, positions, equityHistory: equityHist, maxDD, currentEquity: current, dailyPnl };
}

// ─── テンプレートレポート ─────────────────────────────────────────────────────

function templateReport(s: DaySummary): string {
  const sellOrders = s.orders.filter((o) => o.side === 'SELL');
  const buyOrders  = s.orders.filter((o) => o.side === 'BUY');
  const sign = s.dailyPnl >= 0 ? '+' : '';

  // 決済シグナルから勝敗分析
  const closedSignals = s.signals.filter((sig) => sig.action === 'SELL');
  const wins  = closedSignals.filter((sig) => { const m = JSON.parse(sig.meta_json ?? '{}'); return (m.pnl ?? 0) > 0; });
  const losses = closedSignals.filter((sig) => { const m = JSON.parse(sig.meta_json ?? '{}'); return (m.pnl ?? 0) <= 0; });

  return `# 📊 TradeBot 日次レポート ${s.date}

> AIなしレポート（テンプレートベース）

## 1. 本日のサマリー

| 項目 | 値 |
|------|-----|
| 日付 | ${s.date} |
| 資産残高 | $${s.currentEquity.toFixed(2)} |
| 本日損益 | ${sign}$${s.dailyPnl.toFixed(2)} |
| 最大ドローダウン(30日) | ${s.maxDD.toFixed(2)}% |
| シグナル数 | ${s.signals.filter((sg) => sg.action === 'BUY').length} |
| 買い注文 | ${buyOrders.length} |
| 売り注文 | ${sellOrders.length} |
| 勝ちトレード | ${wins.length} |
| 負けトレード | ${losses.length} |

## 2. 取引詳細

${closedSignals.length === 0
  ? '本日のクローズ取引なし'
  : closedSignals.map((sig) => {
    const m = JSON.parse(sig.meta_json ?? '{}') as { pnl?: number; pnlPct?: number; exitPrice?: number };
    const pnl = m.pnl ?? 0;
    const s2 = pnl >= 0 ? '+' : '';
    return `- **${sig.symbol}** [${sig.reason}]: ${s2}$${pnl.toFixed(2)} (${s2}${((m.pnlPct ?? 0) * 100).toFixed(2)}%)`;
  }).join('\n')
}

## 3. 保有ポジション (${s.positions.length}件)

${s.positions.length === 0
  ? 'なし'
  : s.positions.map((p) =>
    `- **${p.symbol}**: ×${p.qty} @ $${p.avg_price.toFixed(2)} | SL: $${(p.stop_loss ?? 0).toFixed(2)} TP: $${(p.take_profit ?? 0).toFixed(2)}`
  ).join('\n')
}

## 4. 勝敗の要因分析

${wins.length > 0
  ? `**勝ちパターン**: ${wins.map((s) => `${s.symbol}(${s.reason})`).join(', ')}`
  : '勝ちトレードなし'
}

${losses.length > 0
  ? `**負けパターン**: ${losses.map((s) => `${s.symbol}(${s.reason})`).join(', ')}`
  : '負けトレードなし'
}

## 5. 改善案

- 流動性フィルターの閾値（現在: avg_volume > 1M）を見直す
- 出来高倍率閾値（現在: 2x）を市場環境に応じて調整する
- ストップロス幅（現在: -2%）のボラティリティベース化を検討

## 6. 明日やること

- [ ] 全銘柄のデータフェッチ確認
- [ ] 保有ポジションのリスク評価
- [ ] QQQ のトレンド確認（市場レジームフィルター）
`;
}

// ─── AI レポート ──────────────────────────────────────────────────────────────

async function aiReport(s: DaySummary): Promise<string> {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: CONFIG.OPENAI_KEY });

  const prompt = `
あなたは米株ペーパートレードボットのアナリストです。以下のデータを分析して、日次レポートを日本語の Markdown で生成してください。

データ（${s.date}）:
- 資産: $${s.currentEquity.toFixed(2)}
- 本日損益: $${s.dailyPnl.toFixed(2)}
- 最大ドローダウン(30日): ${s.maxDD.toFixed(2)}%
- BUY シグナル: ${JSON.stringify(s.signals.filter((sg) => sg.action === 'BUY').map((sg) => ({ symbol: sg.symbol, reason: sg.reason })))}
- 決済: ${JSON.stringify(s.signals.filter((sg) => sg.action === 'SELL').map((sg) => ({ symbol: sg.symbol, reason: sg.reason, meta: JSON.parse(sg.meta_json ?? '{}') })))}
- 保有中: ${JSON.stringify(s.positions.map((p) => ({ symbol: p.symbol, qty: p.qty, avgPrice: p.avg_price })))}

構成（必須）:
1. 本日のサマリー（表形式）
2. 取引詳細と勝敗理由の分析
3. 最大ドローダウンとリスク評価
4. 具体的な改善案（3点以上、コード修正観点）
5. 明日の行動計画

注意: 売買シグナルや具体的な銘柄への投資アドバイスは出さない。要約・分析のみ。
`.trim();

  logger.info('OpenAI でレポート生成中...');
  const res = await client.chat.completions.create({
    model:      CONFIG.OPENAI_MODEL,
    messages:   [{ role: 'user', content: prompt }],
    max_tokens: 2000,
  });

  return `# 📊 TradeBot 日次レポート ${s.date}\n\n> AI生成 (${CONFIG.OPENAI_MODEL})\n\n` +
    (res.choices[0]?.message.content ?? '(AI応答なし)') +
    '\n\n---\n*Generated by TradeBot AI Reporter*\n';
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

  // ファイル保存
  const filePath = path.join(REPORTS_DIR, `${date}.md`);
  fs.writeFileSync(filePath, content, 'utf-8');

  // DB 保存
  upsertReport(date, content);

  logger.info(`レポート保存: ${filePath}`);
  return content;
}
