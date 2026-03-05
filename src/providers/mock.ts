import type { IDataProvider, OHLCVBar } from '../types/index.js';
import { logger } from '../utils/logger.js';

/** テスト・開発用のモックデータプロバイダー */
export class MockProvider implements IDataProvider {
  async fetchDaily(symbol: string, startDate: string, endDate: string): Promise<OHLCVBar[]> {
    logger.warn(`[Mock] ${symbol} にダミーデータを使用します`);

    const bars: OHLCVBar[] = [];
    const start = new Date(startDate);
    const end   = new Date(endDate);
    let price = 100 + Math.random() * 50;

    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      // 土日スキップ
      if (d.getDay() === 0 || d.getDay() === 6) continue;

      const change = (Math.random() - 0.48) * 3; // わずかに上昇バイアス
      price = Math.max(1, price + change);
      const high   = price * (1 + Math.random() * 0.015);
      const low    = price * (1 - Math.random() * 0.015);
      const open   = low + Math.random() * (high - low);
      const close  = low + Math.random() * (high - low);
      const volume = Math.floor(1_000_000 + Math.random() * 9_000_000);

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
