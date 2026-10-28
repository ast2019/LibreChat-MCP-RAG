import {
  configSchema,
  searchFailoverSchema,
  serviceStatusSchema,
  webSearchSchema,
} from '../src/config';

describe('webSearch.providerChain and serviceStatus config', () => {
  it('leaves the chain unset by default, so the single searchProvider is used', () => {
    const parsed = webSearchSchema.parse({ searchProvider: 'searxng' });

    expect(parsed.providerChain).toBeUndefined();
    expect(parsed.providerFailover).toBeUndefined();
  });

  it('accepts the four chain providers in order and rejects others', () => {
    expect(
      webSearchSchema.parse({ providerChain: ['serper', 'serpapi', 'tavily', 'searxng'] })
        .providerChain,
    ).toEqual(['serper', 'serpapi', 'tavily', 'searxng']);
    expect(webSearchSchema.safeParse({ providerChain: ['bing'] }).success).toBe(false);
    expect(webSearchSchema.safeParse({ providerChain: [] }).success).toBe(false);
  });

  it('reads the SerpApi key only as an environment reference', () => {
    expect(webSearchSchema.safeParse({ serpapiApiKey: '${SERPAPI_API_KEY}' }).success).toBe(true);
    expect(webSearchSchema.safeParse({ serpapiApiKey: 'literal-secret' }).success).toBe(false);
    expect(serviceStatusSchema.safeParse({ openRouterManagementKey: 'sk-or-v1-x' }).success).toBe(
      false,
    );
  });

  it('fills failover and status defaults', () => {
    expect(searchFailoverSchema.parse({})).toEqual({
      exhaustedCooldownSeconds: 3600,
      rateLimitCooldownSeconds: 60,
      unauthorizedCooldownSeconds: 3600,
      timeoutMs: 10_000,
      serpapiHl: 'fa',
      serpapiGl: 'ir',
    });
    expect(serviceStatusSchema.parse({})).toMatchObject({
      refreshIntervalSeconds: 600,
      warningPercent: 20,
      warningDays: 7,
      openRouterApiKey: '${OPENROUTER_KEY}',
    });
    expect(
      configSchema.safeParse({
        version: '1.3.18',
        serviceStatus: { ollamaUrl: 'http://ollama:11434' },
      }).success,
    ).toBe(true);
  });
});
