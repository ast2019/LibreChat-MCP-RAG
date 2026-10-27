import {
  COST_TIER_THRESHOLDS,
  TOKENS_PER_1000_WORDS,
  getBlendedPrice,
  perThousandWords,
  getCostTier,
} from '../tier';

describe('getBlendedPrice', () => {
  it('weighs input three to one against output', () => {
    expect(getBlendedPrice({ prompt: 3, completion: 15 })).toBe(6);
  });

  it('is unknown without both rates', () => {
    expect(getBlendedPrice(undefined)).toBeNull();
    expect(getBlendedPrice({ prompt: 1 })).toBeNull();
    expect(getBlendedPrice({ prompt: Number.NaN, completion: 1 })).toBeNull();
    expect(getBlendedPrice({ prompt: -1, completion: 1 })).toBeNull();
  });
});

describe('getCostTier', () => {
  it('is free at zero', () => {
    expect(getCostTier({ prompt: 0, completion: 0 })).toBe(0);
  });

  it('is unknown without a price', () => {
    expect(getCostTier(undefined)).toBeNull();
    expect(getCostTier({ context: 1000 })).toBeNull();
  });

  it.each([
    [{ prompt: 0.25, completion: 2 }, 1],
    [{ prompt: 1, completion: 5 }, 2],
    [{ prompt: 3, completion: 15 }, 3],
    [{ prompt: 15, completion: 75 }, 4],
  ])('%o → tier %d', (rates, tier) => {
    expect(getCostTier(rates)).toBe(tier);
  });

  it('includes each threshold in the lower tier', () => {
    const [cheap, mid, high] = COST_TIER_THRESHOLDS;
    expect(getCostTier({ prompt: cheap, completion: cheap })).toBe(1);
    expect(getCostTier({ prompt: mid, completion: mid })).toBe(2);
    expect(getCostTier({ prompt: high, completion: high })).toBe(3);
    expect(getCostTier({ prompt: high + 0.01, completion: high + 0.01 })).toBe(4);
  });
});

describe('perThousandWords', () => {
  it('prices ~1300 tokens', () => {
    expect(perThousandWords(1_000_000 / TOKENS_PER_1000_WORDS)).toBeCloseTo(1);
  });
});
