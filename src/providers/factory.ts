import { config } from '../config.js';
import type { IDataProvider } from '../types/index.js';
import { YahooFinanceProvider }    from './yahoo.js';
import { AlphaVantageProvider }    from './alphavantage.js';
import { MockProvider }            from './mock.js';
import { logger } from '../utils/logger.js';

export function createDataProvider(): IDataProvider {
  const provider = config.dataProvider.toLowerCase();
  logger.info(`データプロバイダー: ${provider}`);

  switch (provider) {
    case 'yahoo':
      return new YahooFinanceProvider();
    case 'alphavantage':
      return new AlphaVantageProvider(config.alphaVantageApiKey);
    case 'mock':
      return new MockProvider();
    default:
      logger.warn(`不明なプロバイダー "${provider}"。Yahoo Finance を使用します。`);
      return new YahooFinanceProvider();
  }
}
