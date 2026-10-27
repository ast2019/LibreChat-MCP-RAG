import type { AppConfig } from '@librechat/data-schemas';
import type { CurrencyRates } from '~/billing/currency';
import { warmStartupCaches } from './warmup';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

const appConfig = {
  interfaceConfig: { currency: { code: 'IRT', rate: 270000, live: { source: 'tgju' } } },
  endpoints: {
    custom: [
      {
        name: 'OpenRouter',
        apiKey: 'sk-admin',
        baseURL: 'https://openrouter.test/api/v1',
        models: { default: ['a'], fetch: true },
      },
      {
        name: 'UserKey',
        apiKey: 'user_provided',
        baseURL: 'https://user.test/v1',
        models: { default: ['b'], fetch: true },
      },
    ],
  },
} as unknown as AppConfig;

describe('warmStartupCaches', () => {
  it('fetches admin-keyed endpoint models and reads the live currency rate', async () => {
    const fetchModels = jest.fn().mockResolvedValue(['m1']);
    const resolve = jest.fn().mockResolvedValue({});

    await warmStartupCaches(
      { appConfig },
      { fetchModels, currencyRates: { resolve } as CurrencyRates },
    );

    expect(fetchModels).toHaveBeenCalledTimes(1);
    expect(fetchModels).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'OpenRouter', apiKey: 'sk-admin', tokenKey: 'OpenRouter' }),
    );
    expect(resolve).toHaveBeenCalledWith(appConfig.interfaceConfig?.currency);
  });

  it('never rejects when a warm-up fails', async () => {
    const fetchModels = jest.fn().mockRejectedValue(new Error('down'));
    const resolve = jest.fn().mockRejectedValue(new Error('down'));

    await expect(
      warmStartupCaches(
        { appConfig },
        { fetchModels, currencyRates: { resolve } as CurrencyRates },
      ),
    ).resolves.toBeUndefined();
    await expect(warmStartupCaches({ appConfig: null })).resolves.toBeUndefined();
  });
});
