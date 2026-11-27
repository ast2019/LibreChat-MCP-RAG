/**
 * Regression: after initializeAgent swaps `agent.provider` to `anthropic` for a
 * ClaudeTime custom endpoint, credential lookup must still go through the custom
 * gateway name — never the built-in Anthropic env (`ANTHROPIC_API_KEY`).
 */
import { Providers } from '@librechat/agents';
import { EModelEndpoint } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import { getProviderConfig, providerConfigMap } from './providers';

describe('ClaudeTime credential routing after provider swap', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      CLAUDE_TIME_KEY: 'sk-ant-claudetime-gateway',
      CLAUDE_TIME_BASE_URL: 'https://claudetime.gateway.example',
      ANTHROPIC_API_KEY: 'sk-ant-builtin-should-not-be-used',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const appConfig = {
    endpoints: {
      custom: [
        {
          name: 'ClaudeTime',
          provider: EModelEndpoint.anthropic,
          apiKey: '${CLAUDE_TIME_KEY}',
          baseURL: '${CLAUDE_TIME_BASE_URL}',
          models: { default: ['claude-sonnet-5-5'], fetch: false },
        },
      ],
    },
  } as unknown as AppConfig;

  it('resolves ClaudeTime via custom getOptions with gateway key/URL, not ANTHROPIC_API_KEY', async () => {
    const { getOptions, overrideProvider, customEndpointConfig } = getProviderConfig({
      provider: 'ClaudeTime',
      appConfig,
    });

    expect(overrideProvider).toBe(Providers.ANTHROPIC);
    expect(customEndpointConfig?.apiKey).toBe('${CLAUDE_TIME_KEY}');
    /** Custom endpoints do not use the built-in Anthropic initializer. */
    expect(getOptions).not.toBe(providerConfigMap[EModelEndpoint.anthropic]);

    const options = await getOptions({
      endpoint: 'ClaudeTime',
      model_parameters: { model: 'claude-sonnet-5-5' },
      runtime: { appConfig, user: { id: 'user-1' }, requestBody: {} },
      db: {
        getUserKey: jest.fn(),
        getUserKeyValues: jest.fn(),
      },
    } as unknown as Parameters<typeof getOptions>[0]);

    expect(options.provider).toBe(Providers.ANTHROPIC);
    expect(options.llmConfig).toMatchObject({
      apiKey: 'sk-ant-claudetime-gateway',
      anthropicApiUrl: 'https://claudetime.gateway.example',
    });
    expect((options.llmConfig as { apiKey?: string }).apiKey).not.toBe(
      'sk-ant-builtin-should-not-be-used',
    );
  });

  it('built-in anthropic lookup does not carry ClaudeTime customEndpointConfig', () => {
    const result = getProviderConfig({ provider: EModelEndpoint.anthropic, appConfig });
    expect(result.overrideProvider).toBe(EModelEndpoint.anthropic);
    expect(result.customEndpointConfig).toBeUndefined();
    expect(result.getOptions).toBe(providerConfigMap[EModelEndpoint.anthropic]);
  });

  it('names the unset env var when ClaudeTime credentials are missing', async () => {
    delete process.env.CLAUDE_TIME_KEY;
    delete process.env.CLAUDE_TIME_BASE_URL;
    const { getOptions } = getProviderConfig({ provider: 'ClaudeTime', appConfig });
    await expect(
      getOptions({
        endpoint: 'ClaudeTime',
        model_parameters: { model: 'claude-sonnet-5-5' },
        runtime: { appConfig, user: { id: 'user-1' }, requestBody: {} },
        db: { getUserKey: jest.fn(), getUserKeyValues: jest.fn() },
      } as unknown as Parameters<typeof getOptions>[0]),
    ).rejects.toThrow(/Missing API Key for ClaudeTime: environment variable CLAUDE_TIME_KEY/);
  });
});
