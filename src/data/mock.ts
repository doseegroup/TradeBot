import type { IDataProvider, OHLCVBar } from './types';
import { logger } from '../utils/logger';

/**
 * モックプロバイダー（テスト・開発用）
 * - 流動性フィルター通過のため price > $10, volume > 1M に設定
 * - QQQ は SMA200 上昇トレンドを再現
 */
export class MockProvider implements IDataProvider {
  async fetchDaily(symbol: string, startDate: string, endDate: string): Promise<OHLCVBar[]> {
    logger.warn(`[Mock] ${symbol} にダミーデータを使用`);
    const bars: OHLCVBar[] = [];
    const start = new Date(startDate + 'T12:00:00Z');
    const end   = new Date(endDate   + 'T12:00:00Z');

    // QQQ は価格を高め・安定的に上昇（レジームフィルター通過用）
    const isQQQ = symbol === 'QQQ';
    let price = isQQQ ? 450 : 50 + Math.random() * 100;

    for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const dow = d.getUTCDay();
      if (dow === 0 || dow === 6) continue; // 土日スキップ

      // QQQ は緩やかな上昇、個別株はランダムウォーク（上昇バイアス）
      const drift = isQQQ ? 0.03 : (Math.random() - 0.47) * 2;
      price = Math.max(15, price + drift);

      const spread = price * 0.01;
      const high   = price + spread * Math.random();
      const low    = price - spread * Math.random();
      const open   = low + Math.random() * (high - low);
      const close  = low + Math.random() * (high - low);
      // 出来高は流動性フィルター通過のため 2M〜10M
      const volume = Math.floor(2_000_000 + Math.random() * 8_000_000);

      bars.push({
        symbol,
        date:   d.toISOString().slice(0, 10),
        open:   +open.toFixed(2),
        high:   +high.toFixed(2),
        low:    +low.toFixed(2),
        close:  +close.toFixed(2),
        volume,
      });
    }

    logger.debug(`[Mock] ${symbol}: ${bars.length} 件生成`);
    return bars;
  }
}
