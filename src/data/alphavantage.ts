import axios from 'axios';
import type { IDataProvider, OHLCVBar } from './types';
import { logger } from '../utils/logger';

interface AVEntry {
  '1. open': string; '2. high': string; '3. low': string;
  '4. close': string; '5. volume': string;
}

export class AlphaVantageProvider implements IDataProvider {
  private readonly apiKey: string;
  private readonly base = 'https://www.alphavantage.co/query';

  constructor(apiKey: string) {
    if (!apiKey) throw new Error('ALPHA_VANTAGE_API_KEY が未設定です');
    this.apiKey = apiKey;
  }

  async fetchDaily(symbol: string, startDate: string, endDate: string): Promise<OHLCVBar[]> {
    logger.debug(`[AlphaVantage] ${symbol} ${startDate}〜${endDate}`);
    const { data } = await axios.get<Record<string, unknown>>(this.base, {
      params: { function: 'TIME_SERIES_DAILY', symbol, outputsize: 'full', apikey: this.apiKey },
      timeout: 15000,
    });

    const note = (data['Note'] ?? data['Information']) as string | undefined;
    if (note) throw new Error(`AlphaVantage 制限: ${note}`);
    const err = data['Error Message'] as string | undefined;
    if (err) throw new Error(`AlphaVantage エラー: ${err}`);

    const ts = data['Time Series (Daily)'] as Record<string, AVEntry> | undefined;
    if (!ts) throw new Error(`${symbol}: データなし`);

    return Object.entries(ts)
      .filter(([d]) => d >= startDate && d <= endDate)
      .map(([date, e]) => ({
        symbol, date,
        open:   parseFloat(e['1. open']),
        high:   parseFloat(e['2. high']),
        low:    parseFloat(e['3. low']),
        close:  parseFloat(e['4. close']),
        volume: parseInt(e['5. volume'], 10),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
}
