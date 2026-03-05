# 📊 TradeBot v2

米株ペーパートレード研究用ボット — Node.js + TypeScript + SQLite

## 概要

- **データ取得**: Yahoo Finance（無料）/ Alpha Vantage / モック
- **戦略**: 20日高値ブレイク + 出来高急増 (2x)
- **フィルター**: 流動性・市場レジーム（QQQ SMA）・決算
- **約定モデル**: T+1（シグナル翌営業日の始値で約定、スリッページ 0.1%）
- **リスク管理**: 日次損失上限 3%・最大2銘柄・3連敗→48h クールダウン
- **通知**: LINE Messaging API
- **レポート**: AI（OpenAI）またはテンプレートで日次 Markdown レポート生成

---

## セットアップ

### 1. 依存パッケージのインストール

```bash
npm install
```

### 2. .env の設定

```bash
cp .env.example .env
```

`.env` を編集：

```env
# データプロバイダー（yahoo / alphavantage / mock）
DATA_PROVIDER=yahoo

# LINE（任意）
LINE_CHANNEL_ACCESS_TOKEN=xxxx
LINE_TO=Uxxxx

# OpenAI（任意。なければテンプレートレポート）
OPENAI_API_KEY=sk-xxxx

# 初期資金（USD）
INITIAL_EQUITY=10000
MAX_POSITION_USD=1000
```

### 3. DB 初期化

```bash
npm run init-db
```

---

## コマンドリファレンス

| コマンド | 説明 |
|---------|------|
| `npm run fetch` | 全銘柄（QQQ含む）の最新 OHLCV を取得して DB 保存 |
| `npm run run` | フル取引サイクル（fetch → フィルター → シグナル → 約定 → 通知） |
| `npm run report [YYYY-MM-DD]` | 日次レポート生成（省略時=今日） |
| `npm run backfill -- --symbols AAPL,MSFT,QQQ --days 365` | 過去データを一括取得 |
| `npm test` | ユニットテスト実行 |
| `npm run dashboard` | ブラウザダッシュボード起動 (http://localhost:3000) |
| `npm run export` | 取引ログを CSV エクスポート |
| `npm run init-db` | DB 初期化（テーブル作成） |

---

## 実行例

```bash
# テスト用モックデータで動かす場合
echo "DATA_PROVIDER=mock" >> .env

# 過去 60 日分のデータを取得
npm run backfill -- --symbols AAPL,MSFT,NVDA,QQQ --days 60

# 取引サイクルを実行
npm run run

# 翌日、再度 run で前日シグナルが T+1 約定される
npm run run

# レポート生成
npm run report
```

---

## cron 設定例（米国市場クローズ後）

米国東部時間 16:00 ≒ 日本時間 翌6:00 (夏時間) / 翌7:00 (冬時間)

```cron
# 平日（米市場営業日）16:10 ET にデータ取得 + 取引実行
10 6 * * 2-6  cd /path/to/TradeBot && npm run run  >> logs/cron.log 2>&1

# 16:30 ET に日次レポート生成
30 6 * * 2-6  cd /path/to/TradeBot && npm run report >> logs/cron.log 2>&1
```

> `TZ=America/New_York` または `TZ=Asia/Tokyo` を `.env` に設定してください。

---

## ディレクトリ構成

```
TradeBot/
├── src/
│   ├── config/          # 全パラメータ一元管理 (index.ts)
│   ├── data/            # DataProvider (yahoo/alphavantage/mock + factory)
│   ├── strategy/
│   │   ├── breakout.ts  # エントリー戦略・ポジションサイジング
│   │   └── filters.ts   # 流動性・レジーム・決算フィルター
│   ├── risk/
│   │   └── engine.ts    # Kill Switch, クールダウン, 日次損失管理
│   ├── paper/
│   │   └── executor.ts  # T+1 約定実行エンジン
│   ├── db/
│   │   ├── client.ts    # DB 接続
│   │   ├── migrations.ts # スキーマ定義
│   │   ├── prices.ts    # prices テーブル
│   │   ├── signals.ts   # signals テーブル
│   │   ├── orders.ts    # orders + fills テーブル
│   │   ├── positions.ts # positions テーブル
│   │   ├── equity.ts    # equity テーブル
│   │   ├── reports.ts   # daily_reports テーブル
│   │   └── system.ts    # system_state テーブル（Kill Switch等）
│   ├── notify/
│   │   └── line.ts      # LINE 通知
│   ├── report/
│   │   └── generator.ts # 日次レポート生成
│   ├── utils/
│   │   ├── logger.ts    # console + ファイル + DB ロギング
│   │   ├── date.ts      # 日付ユーティリティ
│   │   └── math.ts      # SMA・DD・統計計算
│   └── cli/             # CLIエントリーポイント
│       ├── fetch.ts
│       ├── run.ts
│       ├── report.ts
│       ├── backfill.ts
│       └── init-db.ts
├── config/
│   ├── watchlist.json   # 監視銘柄（QQQ必須）
│   └── earnings.csv     # 決算日フィルター
├── reports/             # 生成されたレポート
├── tests/
│   ├── strategy.test.ts # 戦略ユニットテスト
│   └── pnl.test.ts      # 損益計算ユニットテスト
└── data/
    └── tradebot.db      # SQLite DB（自動生成）
```

---

## DB スキーマ

| テーブル | 説明 |
|---------|------|
| `prices` | OHLCV 価格データ |
| `signals` | 生成シグナル（BUY/SELL）|
| `orders` | 注文（PENDING/FILLED/CANCELLED）|
| `fills` | 約定明細（orders の詳細）|
| `positions` | 現在の保有ポジション |
| `equity` | 日次資産推移・ドローダウン |
| `daily_reports` | レポート内容 |
| `system_state` | Kill Switch, クールダウン, 連敗カウント |
| `logs` | DB ログ（console と二重記録）|

---

## 戦略詳細

### エントリー（BUY）

```
close_today > max(high[-20:-1])           ← 20日高値ブレイク
AND volume_today > avg(volume[-20:-1]) × 2 ← 出来高急増
```

### イグジット

| 種別 | 条件 |
|------|------|
| Stop Loss | close ≤ avg_price × (1 - 2%) |
| Take Profit | close ≥ avg_price × (1 + 4%) |
| Trailing Stop | close ≤ 最高値 × (1 - 2%)（設定で ON/OFF）|

### 約定モデル

- **エントリー**: シグナル当日に PENDING オーダー → **翌営業日の始値**で約定
  - 始値がない場合は終値を使用（ログに理由を記録）
  - スリッページ 0.1% 適用（買いは高く: open × 1.001）
- **イグジット**: 条件成立した当日終値で即時約定
  - スリッページ 0.1% 適用（売りは安く: close × 0.999）

---

## リスク管理

| パラメータ | デフォルト | 説明 |
|-----------|-----------|------|
| `MAX_POSITIONS` | 2 | 同時保有最大銘柄数 |
| `MAX_DAILY_LOSS_PCT` | 3% | 日次損失上限（超えたら Kill Switch 発動）|
| `MAX_POSITION_USD` | $1000 | 1銘柄最大投入額 |
| `RISK_PER_TRADE_PCT` | 1% | 1トレード最大リスク（equity の 1%）|
| `CONSEC_LOSS_LIMIT` | 3 | 連続損失上限（超えたらクールダウン）|
| `COOLDOWN_HOURS` | 48 | クールダウン時間（時間）|

### ポジションサイジング

```
riskShares = (equity × 1%) / (price × 2%)   ← SL の損失が equity の 1% 以内
maxShares  = MAX_POSITION_USD / price
qty = min(riskShares, maxShares)
```

---

## フィルター

### 流動性フィルター
- 株価 > $10
- 20日平均出来高 > 100万株

### 市場レジームフィルター（QQQ）
- QQQ close > SMA(200)
- QQQ SMA(50) > SMA(200)
- 両条件を満たさない場合、新規エントリー禁止

### 決算フィルター
- `config/earnings.csv` に `symbol,date` 形式で決算日を記載
- 決算日の前後 1 営業日は新規エントリー禁止

---

## Kill Switch の手動解除

```bash
sqlite3 data/tradebot.db "INSERT INTO system_state (key,value) VALUES ('kill_switch','0') ON CONFLICT(key) DO UPDATE SET value='0';"
```

---

## ユニットテスト

```bash
npm test
```

テスト内容:
- `tests/strategy.test.ts`: ブレイクアウト条件, 流動性フィルター, 市場レジームフィルター, ポジションサイジング
- `tests/pnl.test.ts`: スリッページ計算, PnL 計算, 最大ドローダウン計算, SMA 計算

---

## MVP の制約と今後の改善点

### 現在の単純化
- スプレッドはデータがないため省略（将来: bid-ask スプレッド適用）
- 約定価格は始値を使用（将来: VWAP や TWAP で改善）
- ポジションは全量一括クローズのみ（将来: 一部利確 / ピラミッディング）
- 決算日は `config/earnings.csv` に手動登録（将来: API で自動取得）
- スリッページは固定 0.1%（将来: 市場インパクト・流動性ベースで動的計算）

### 将来の拡張ポイント
- **相関管理**: 高相関銘柄は同時保有しない（例: 相関係数 > 0.8 は除外）
- **セクター分散**: 同セクターへの集中投資を制限
- **ポジション調整**: 既存ポジションの決算前クローズオプション
- **バックテスト**: `npm run backtest` で過去データによる戦略検証
- **1銘柄最大投入額の動的計算**: JPY/USD レートを参照して10〜15万円相当に自動換算

---

## LINE Messaging API 設定

1. [LINE Developers](https://developers.line.biz/) で Messaging API チャンネルを作成
2. チャンネルアクセストークンを発行 → `LINE_CHANNEL_ACCESS_TOKEN`
3. 送信先 ID を取得 → `LINE_TO`（`U` 始まり = ユーザー / `C` 始まり = グループ）
