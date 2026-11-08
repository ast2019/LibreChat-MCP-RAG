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

describe('warmStartupCaches model catalogue', () => {
  const discovering = (autoDiscover: Record<string, unknown>) =>
    ({
      ...appConfig,
      modelSpecs: { list: [], autoDiscover: { endpoint: 'OpenRouter', ...autoDiscover } },
    }) as unknown as AppConfig;
  const deps = () => ({
    fetchModels: jest.fn().mockResolvedValue([]),
    currencyRates: { resolve: jest.fn().mockResolvedValue({}) } as unknown as CurrencyRates,
    modelCatalogue: {
      start: jest.fn().mockResolvedValue(undefined),
      refresh: jest.fn(),
      stop: jest.fn(),
      getSnapshot: jest.fn(),
    },
  });

  it('starts the catalogue from the discovery endpoint every refreshHours', async () => {
    const d = deps();
    await warmStartupCaches(
      { appConfig: discovering({ enabled: true, refreshHours: 6, timeoutMs: 2000 }) },
      d,
    );
    expect(d.modelCatalogue.start).toHaveBeenCalledWith(
      { baseURL: 'https://openrouter.test/api/v1', apiKey: 'sk-admin', timeoutMs: 2000 },
      6 * 3_600_000,
    );
  });

  it('does not fetch the catalogue when discovery is off', async () => {
    const d = deps();
    await warmStartupCaches({ appConfig: discovering({ enabled: false }) }, d);
    await warmStartupCaches({ appConfig }, d);
    expect(d.modelCatalogue.start).not.toHaveBeenCalled();
  });
});

describe('warmStartupCaches image model catalogue', () => {
  const withMedia = (image: Record<string, unknown>) =>
    ({
      ...appConfig,
      config: { mediaGeneration: { enabled: true, endpoint: 'OpenRouter', image } },
    }) as unknown as AppConfig;
  const deps = () => ({
    fetchModels: jest.fn().mockResolvedValue([]),
    currencyRates: { resolve: jest.fn().mockResolvedValue({}) } as unknown as CurrencyRates,
    imageCatalogue: {
      start: jest.fn().mockResolvedValue(undefined),
      refresh: jest.fn(),
      stop: jest.fn(),
      getModels: jest.fn(),
    },
  });

  it('reads the media endpoint’s image models every refreshHours', async () => {
    const d = deps();
    await warmStartupCaches(
      { appConfig: withMedia({ model: 'openai/gpt-image-2', catalogue: true, refreshHours: 3 }) },
      d,
    );
    expect(d.imageCatalogue.start).toHaveBeenCalledWith(
      { baseURL: 'https://openrouter.test/api/v1', apiKey: 'sk-admin', timeoutMs: 15_000 },
      3 * 3_600_000,
    );
  });

  it('does not read it when the catalogue is off', async () => {
    const d = deps();
    await warmStartupCaches({ appConfig: withMedia({ model: 'openai/gpt-image-2' }) }, d);
    expect(d.imageCatalogue.start).not.toHaveBeenCalled();
  });
});
