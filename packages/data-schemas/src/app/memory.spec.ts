import { isMemoryExcludedForEndpoint } from './memory';

describe('isMemoryExcludedForEndpoint', () => {
  it('matches excluded endpoints case-insensitively', () => {
    const config = { excludeEndpoints: ['Local'] };
    expect(isMemoryExcludedForEndpoint(config, 'local')).toBe(true);
    expect(isMemoryExcludedForEndpoint(config, 'LOCAL')).toBe(true);
    expect(isMemoryExcludedForEndpoint(config, 'OpenRouter')).toBe(false);
  });

  it('excludes nothing without a list or an endpoint', () => {
    expect(isMemoryExcludedForEndpoint({}, 'Local')).toBe(false);
    expect(isMemoryExcludedForEndpoint(undefined, 'Local')).toBe(false);
    expect(isMemoryExcludedForEndpoint({ excludeEndpoints: ['Local'] }, undefined)).toBe(false);
    expect(isMemoryExcludedForEndpoint({ excludeEndpoints: ['Local'] }, '')).toBe(false);
  });
});
