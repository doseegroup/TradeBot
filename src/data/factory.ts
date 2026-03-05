import { CONFIG } from '../config/index';
import type { IDataProvider } from './types';
import { YahooProvider }         from './yahoo';
import { AlphaVantageProvider }  from './alphavantage';
import { MockProvider }          from './mock';
import { logger } from '../utils/logger';

export function createProvider(): IDataProvider {
  const name = CONFIG.DATA_PROVIDER.toLowerCase();
  logger.info(`データプロバイダー: ${name}`);
  switch (name) {
    case 'yahoo':
      return new YahooProvider();
    case 'alphavantage':
      return new AlphaVantageProvider(CONFIG.ALPHA_VANTAGE_KEY);
    case 'mock':
      return new MockProvider();
    default:
      logger.warn(`不明なプロバイダー "${name}" → Yahoo にフォールバック`);
      return new YahooProvider();
  }
}
