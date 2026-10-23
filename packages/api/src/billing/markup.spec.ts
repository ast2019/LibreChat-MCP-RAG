import type { EndpointTokenConfig } from '~/types';
import { applyPriceMultiplier, isEffectivePriceMultiplier } from './markup';

const fetched = (): EndpointTokenConfig => ({
  'openai/gpt-4o-mini': { prompt: 0.15, completion: 0.6, context: 128000, read: 0.075 },
  'anthropic/claude-sonnet': {
    prompt: 3,
    completion: 15,
    context: 200000,
    read: 0.3,
    write: 3.75,
    write1h: 6,
  },
});

describe('applyPriceMultiplier', () => {
  it('scales every rate and keeps the context window', () => {
    const result = applyPriceMultiplier(fetched(), 1.5);
    expect(result?.['openai/gpt-4o-mini']).toEqual({
      prompt: expect.closeTo(0.225),
      completion: expect.closeTo(0.9),
      context: 128000,
      read: expect.closeTo(0.1125),
    });
    expect(result?.['anthropic/claude-sonnet']).toEqual({
      prompt: 4.5,
      completion: 22.5,
      context: 200000,
      read: expect.closeTo(0.45),
      write: 5.625,
      write1h: 9,
    });
  });

  it('scales the admin-facing static cache keys too', () => {
    const result = applyPriceMultiplier(
      { m: { prompt: 1, completion: 2, context: 10, cacheRead: 0.1, cacheWrite: 1.25 } },
      2,
    );
    expect(result?.m).toEqual({
      prompt: 2,
      completion: 4,
      context: 10,
      cacheRead: 0.2,
      cacheWrite: 2.5,
    });
  });

  it('never mutates the shared input', () => {
    const input = fetched();
    applyPriceMultiplier(input, 3);
    expect(input).toEqual(fetched());
  });

  it.each([undefined, 1, 0, -2, Number.NaN, Number.POSITIVE_INFINITY])(
    'returns the same object for the neutral or invalid multiplier %p',
    (multiplier) => {
      const input = fetched();
      expect(applyPriceMultiplier(input, multiplier)).toBe(input);
    },
  );

  it('passes a missing config through', () => {
    expect(applyPriceMultiplier(undefined, 2)).toBeUndefined();
  });
});

describe('isEffectivePriceMultiplier', () => {
  it('accepts only finite positive values other than 1', () => {
    expect(isEffectivePriceMultiplier(1.3)).toBe(true);
    expect(isEffectivePriceMultiplier(0.5)).toBe(true);
    expect(isEffectivePriceMultiplier(1)).toBe(false);
    expect(isEffectivePriceMultiplier('1.3')).toBe(false);
  });
});
