import { isMemoryExcludedForEndpoint, isMemoryReadExcludedForEndpoint } from './memory';

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

describe('isMemoryReadExcludedForEndpoint', () => {
  it('keeps an excluded endpoint from reading unless excludeEndpointsRead is on', () => {
    const config = { excludeEndpoints: ['Local'] };
    expect(isMemoryReadExcludedForEndpoint(config, 'Local')).toBe(true);
    expect(
      isMemoryReadExcludedForEndpoint({ ...config, excludeEndpointsRead: true }, 'Local'),
    ).toBe(false);
    /** Writing stays excluded either way */
    expect(isMemoryExcludedForEndpoint({ ...config, excludeEndpointsRead: true }, 'Local')).toBe(
      true,
    );
  });

  it('never excludes an endpoint that is not listed', () => {
    expect(isMemoryReadExcludedForEndpoint({ excludeEndpoints: ['Local'] }, 'OpenRouter')).toBe(
      false,
    );
  });
});
