import axios from 'axios';
import type { IDataProvider, OHLCVBar } from '../types/index.js';
import { logger } from '../utils/logger.js';

interface AlphaVantageTimeSeriesEntry {
  '1. open':   string;
  '2. high':   string;
  '3. low':    string;
  '4. close':  string;
  '5. volume': string;
}

interface AlphaVantageResponse {
  'Time Series (Daily)'?: Record<string, AlphaVantageTimeSeriesEntry>;
  'Note'?: string;
  'Information'?: string;
  'Error Message'?: string;
}

export class AlphaVantageProvider implements IDataProvider {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://www.alphavantage.co/query';

  constructor(apiKey: string) {
    if (!apiKey) throw new Error('Alpha Vantage APIキーが設定されていません');
    this.apiKey = apiKey;
  }

  async fetchDaily(symbol: string, startDate: string, endDate: string): Promise<OHLCVBar[]> {
    logger.debug(`[AlphaVantage] ${symbol} ${startDate}〜${endDate} フェッチ中...`);

    const params = {
      function:    'TIME_SERIES_DAILY',
      symbol,
      outputsize: 'full',
      apikey:      this.apiKey,
    };

    const { data } = await axios.get<AlphaVantageResponse>(this.baseUrl, { params, timeout: 15000 });

    if (data['Note'] || data['Information']) {
      throw new Error(`Alpha Vantage API制限: ${data['Note'] ?? data['Information']}`);
    }
    if (data['Error Message']) {
      throw new Error(`Alpha Vantage エラー: ${data['Error Message']}`);
    }

    const timeSeries = data['Time Series (Daily)'];
    if (!timeSeries) throw new Error(`${symbol}: Alpha Vantage データなし`);

    const bars: OHLCVBar[] = Object.entries(timeSeries)
      .filter(([date]) => date >= startDate && date <= endDate)
      .map(([date, entry]) => ({
        symbol,
        date,
        open:   parseFloat(entry['1. open']),
        high:   parseFloat(entry['2. high']),
        low:    parseFloat(entry['3. low']),
        close:  parseFloat(entry['4. close']),
        volume: parseInt(entry['5. volume'], 10),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    logger.debug(`[AlphaVantage] ${symbol}: ${bars.length} 件取得`);
    return bars;
  }
}
