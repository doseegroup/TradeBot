/**
 * npm run dashboard
 * ローカルダッシュボード（Express + Chart.js）を起動する
 * http://localhost:3000
 */
import 'dotenv/config';
import express from 'express';
import { runMigrations } from '../db/schema.js';
import {
  getOpenPositions, getAllTrades, getDailyRiskHistory,
  calcCurrentEquity,
} from '../db/queries.js';
import { isKillSwitchActive } from '../utils/killswitch.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const PORT = process.env['PORT'] ? parseInt(process.env['PORT'], 10) : 3000;

function buildHtml(data: {
  equity: number;
  positions: ReturnType<typeof getOpenPositions>;
  trades: ReturnType<typeof getAllTrades>;
  riskHistory: ReturnType<typeof getDailyRiskHistory>;
  killSwitchActive: boolean;
}): string {
  const { equity, positions, trades, riskHistory, killSwitchActive } = data;

  const recentTrades = trades.slice(-20).reverse();
  const wins  = trades.filter((t) => t.pnl > 0).length;
  const total = trades.length;
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';

  // Chart.js 用データ
  const chartLabels = JSON.stringify(riskHistory.map((h) => h.date));
  const chartData   = JSON.stringify(riskHistory.map((h) => h.currentEquity.toFixed(2)));

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TradeBot Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f1117; color: #e2e8f0; }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    h1 { font-size: 24px; margin-bottom: 4px; color: #f7fafc; }
    .subtitle { color: #718096; font-size: 13px; margin-bottom: 24px; }
    .kill-switch-banner { background: #742a2a; color: #fc8181; padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; font-weight: 600; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .card { background: #1a202c; border-radius: 12px; padding: 20px; border: 1px solid #2d3748; }
    .card-label { font-size: 12px; color: #718096; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
    .card-value { font-size: 28px; font-weight: 700; }
    .positive { color: #68d391; }
    .negative { color: #fc8181; }
    .neutral  { color: #f7fafc; }
    .section { background: #1a202c; border-radius: 12px; padding: 20px; border: 1px solid #2d3748; margin-bottom: 20px; }
    .section-title { font-size: 14px; font-weight: 600; color: #a0aec0; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 8px 12px; color: #718096; border-bottom: 1px solid #2d3748; }
    td { padding: 10px 12px; border-bottom: 1px solid #2d3748; }
    tr:last-child td { border-bottom: none; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; }
    .badge-buy  { background: #276749; color: #9ae6b4; }
    .badge-sell { background: #742a2a; color: #fc8181; }
    .chart-container { position: relative; height: 200px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>📊 TradeBot Dashboard</h1>
    <p class="subtitle">自動更新: <span id="lastUpdate"></span></p>

    ${killSwitchActive ? '<div class="kill-switch-banner">🚨 Kill Switch 有効 — 取引停止中</div>' : ''}

    <div class="grid">
      <div class="card">
        <div class="card-label">仮想資産残高</div>
        <div class="card-value neutral">$${equity.toFixed(2)}</div>
      </div>
      <div class="card">
        <div class="card-label">総損益</div>
        <div class="card-value ${totalPnl >= 0 ? 'positive' : 'negative'}">${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}</div>
      </div>
      <div class="card">
        <div class="card-label">勝率</div>
        <div class="card-value neutral">${winRate}%</div>
      </div>
      <div class="card">
        <div class="card-label">総取引数</div>
        <div class="card-value neutral">${total}</div>
      </div>
      <div class="card">
        <div class="card-label">保有中</div>
        <div class="card-value neutral">${positions.length}</div>
      </div>
    </div>

    <!-- 資産推移チャート -->
    <div class="section">
      <div class="section-title">資産推移 (過去30日)</div>
      <div class="chart-container">
        <canvas id="equityChart"></canvas>
      </div>
    </div>

    <!-- 保有ポジション -->
    <div class="section">
      <div class="section-title">保有ポジション (${positions.length}件)</div>
      ${positions.length === 0
        ? '<p style="color:#718096; font-size:13px;">保有ポジションなし</p>'
        : `<table>
          <thead><tr>
            <th>銘柄</th><th>株数</th><th>取得価格</th><th>取得日</th>
            <th>SL</th><th>TP</th>
          </tr></thead>
          <tbody>
            ${positions.map((p) => `
              <tr>
                <td><strong>${p.symbol}</strong></td>
                <td>${p.quantity}</td>
                <td>$${p.entryPrice.toFixed(2)}</td>
                <td>${p.entryDate}</td>
                <td style="color:#fc8181">$${p.stopLoss.toFixed(2)}</td>
                <td style="color:#68d391">$${p.takeProfit.toFixed(2)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>`
      }
    </div>

    <!-- 直近取引 -->
    <div class="section">
      <div class="section-title">直近取引 (最新20件)</div>
      ${recentTrades.length === 0
        ? '<p style="color:#718096; font-size:13px;">取引履歴なし</p>'
        : `<table>
          <thead><tr>
            <th>銘柄</th><th>エントリー</th><th>イグジット</th>
            <th>損益</th><th>損益%</th><th>理由</th>
          </tr></thead>
          <tbody>
            ${recentTrades.map((t) => {
              const pnlClass = t.pnl >= 0 ? 'positive' : 'negative';
              const sign = t.pnl >= 0 ? '+' : '';
              return `<tr>
                <td><strong>${t.symbol}</strong></td>
                <td>${t.entryDate}</td>
                <td>${t.exitDate}</td>
                <td class="${pnlClass}">${sign}$${t.pnl.toFixed(2)}</td>
                <td class="${pnlClass}">${sign}${(t.pnlPct * 100).toFixed(2)}%</td>
                <td><span class="badge badge-sell">${t.reason}</span></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>`
      }
    </div>
  </div>

  <script>
    document.getElementById('lastUpdate').textContent = new Date().toLocaleString('ja-JP');

    const ctx = document.getElementById('equityChart').getContext('2d');
    new Chart(ctx, {
      type: 'line',
      data: {
        labels: ${chartLabels},
        datasets: [{
          label: '資産残高 ($)',
          data: ${chartData},
          borderColor: '#667eea',
          backgroundColor: 'rgba(102,126,234,0.1)',
          borderWidth: 2,
          pointRadius: 3,
          fill: true,
          tension: 0.3,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#718096', maxTicksLimit: 10 }, grid: { color: '#2d3748' } },
          y: { ticks: { color: '#718096' }, grid: { color: '#2d3748' } },
        },
      }
    });
  </script>
</body>
</html>`;
}

async function main(): Promise<void> {
  runMigrations();

  const app = express();

  app.get('/', (_req, res) => {
    try {
      const equity          = calcCurrentEquity(config.initialEquity);
      const positions       = getOpenPositions();
      const trades          = getAllTrades();
      const riskHistory     = getDailyRiskHistory(30);
      const killSwitchActive = isKillSwitchActive();

      res.send(buildHtml({ equity, positions, trades, riskHistory, killSwitchActive }));
    } catch (err) {
      logger.error('ダッシュボードレンダリングエラー:', err);
      res.status(500).send('Internal Server Error');
    }
  });

  // JSON API エンドポイント（外部ツール連携用）
  app.get('/api/summary', (_req, res) => {
    const equity    = calcCurrentEquity(config.initialEquity);
    const positions = getOpenPositions();
    const trades    = getAllTrades();
    res.json({
      equity,
      openPositions: positions.length,
      totalTrades:   trades.length,
      totalPnl:      trades.reduce((s, t) => s + t.pnl, 0),
      killSwitchActive: isKillSwitchActive(),
    });
  });

  app.listen(PORT, () => {
    logger.info(`ダッシュボード起動: http://localhost:${PORT}`);
    console.log(`\n✅ ダッシュボード: http://localhost:${PORT}\n`);
  });
}

main().catch((err) => {
  logger.error('dashboardコマンド 致命的エラー:', err);
  process.exit(1);
});
