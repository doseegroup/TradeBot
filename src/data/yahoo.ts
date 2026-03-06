/**
 * Yahoo Finance v8 Chart API から OHLCV を取得
 * yahoo-finance2 パッケージは使わず axios で直接呼び出す
 */
import axios from 'axios';
import type { IDataProvider, OHLCVBar } from './types';
import { logger } from '../utils/logger';

interface YahooChartResponse {
  chart: {
    result: Array<{
      timestamp: number[];
      indicators: {
        quote: Array<{
          open:   (number | null)[];
          high:   (number | null)[];
          low:    (number | null)[];
          close:  (number | null)[];
          volume: (number | null)[];
        }>;
      };
    }>;
    error: unknown;
  };
}

export class YahooProvider implements IDataProvider {
  async fetchDaily(symbol: string, startDate: string, endDate: string): Promise<OHLCVBar[]> {
    logger.debug(`[Yahoo] ${symbol} ${startDate}〜${endDate}`);

    const period1 = Math.floor(new Date(startDate + 'T00:00:00Z').getTime() / 1000);
    const period2 = Math.floor(new Date(endDate   + 'T23:59:59Z').getTime() / 1000);

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`;
    const { data } = await axios.get<YahooChartResponse>(url, {
      params: { period1, period2, interval: '1d', events: 'div,splits' },
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 15000,
    });

    if (data.chart.error) throw new Error(`Yahoo Finance エラー: ${JSON.stringify(data.chart.error)}`);

    const result = data.chart.result?.[0];
    if (!result) throw new Error(`${symbol}: Yahoo Finance データなし`);

    const timestamps = result.timestamp;
    const quote      = result.indicators.quote[0];

    if (!timestamps || !quote) throw new Error(`${symbol}: データ形式エラー`);

    const bars: OHLCVBar[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const open   = quote.open[i];
      const high   = quote.high[i];
      const low    = quote.low[i];
      const close  = quote.close[i];
      const volume = quote.volume[i];

      if (open == null || high == null || low == null || close == null || volume == null) continue;

      const date = new Date(timestamps[i]! * 1000).toISOString().slice(0, 10);
      bars.push({ symbol, date, open, high, low, close, volume });
    }

    bars.sort((a, b) => a.date.localeCompare(b.date));
    logger.debug(`[Yahoo] ${symbol}: ${bars.length} 件取得`);
    return bars;
  }
}
