import yahooFinance from 'yahoo-finance2';
import type { IDataProvider, OHLCVBar } from '../types/index.js';
import { logger } from '../utils/logger.js';

export class YahooFinanceProvider implements IDataProvider {
  async fetchDaily(symbol: string, startDate: string, endDate: string): Promise<OHLCVBar[]> {
    logger.debug(`[Yahoo] ${symbol} ${startDate}〜${endDate} フェッチ中...`);

    const results = await yahooFinance.historical(symbol, {
      period1:  startDate,
      period2:  endDate,
      interval: '1d',
    });

    const bars: OHLCVBar[] = results
      .filter(
        (r) =>
          r.open  != null &&
          r.high  != null &&
          r.low   != null &&
          r.close != null &&
          r.volume != null,
      )
      .map((r) => ({
        symbol,
        date:   (r.date as Date).toISOString().slice(0, 10),
        open:   r.open   as number,
        high:   r.high   as number,
        low:    r.low    as number,
        close:  r.close  as number,
        volume: r.volume as number,
      }));

    logger.debug(`[Yahoo] ${symbol}: ${bars.length} 件取得`);
    return bars;
  }
}
