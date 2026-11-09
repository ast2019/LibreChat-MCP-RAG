import type { RefillIntervalUnit } from './balance';
import {
  getRefillEligibilityDate,
  MAX_GIFT_CREDITS,
  MAX_GRANT_CREDITS,
  MAX_PACK_CREDITS,
  packPriceRial,
  packSaleAmount,
} from './balance';

describe('getRefillEligibilityDate', () => {
  it.each([
    ['seconds', 30, '2026-05-05T16:00:30.000Z'],
    ['minutes', 15, '2026-05-05T16:15:00.000Z'],
    ['hours', 2, '2026-05-05T18:00:00.000Z'],
    ['days', 1, '2026-05-06T16:00:00.000Z'],
    ['weeks', 1, '2026-05-12T16:00:00.000Z'],
    ['months', 1, '2026-06-05T16:00:00.000Z'],
  ] as const)(
    'returns lastRefill plus %s for the refill eligibility date',
    (unit: RefillIntervalUnit, value: number, expected: string) => {
      const lastRefill = new Date('2026-05-05T16:00:00.000Z');

      expect(getRefillEligibilityDate(lastRefill, value, unit)).toEqual(new Date(expected));
    },
  );

  it('computes eligibility from an old lastRefill without considering current time', () => {
    const lastRefill = new Date('2026-05-03T16:00:00.000Z');

    expect(getRefillEligibilityDate(lastRefill, 1, 'days')).toEqual(
      new Date('2026-05-04T16:00:00.000Z'),
    );
  });

  it('returns the last refill date for a zero-value interval', () => {
    const lastRefill = new Date('2026-05-05T16:00:00.000Z');

    expect(getRefillEligibilityDate(lastRefill, 0, 'days')).toEqual(lastRefill);
  });

  it('documents JavaScript month-end rollover behavior', () => {
    const lastRefill = new Date('2026-01-31T12:00:00.000Z');

    expect(getRefillEligibilityDate(lastRefill, 1, 'months')).toEqual(
      new Date('2026-03-03T12:00:00.000Z'),
    );
  });

  it('returns a Date fallback for unknown runtime interval units', () => {
    const lastRefill = new Date('2026-05-05T16:00:00.000Z');
    const unknownUnit = 'years' as unknown as RefillIntervalUnit;

    expect(getRefillEligibilityDate(lastRefill, 1, unknownUnit)).toEqual(lastRefill);
  });
});

describe('credit ceilings', () => {
  it('keeps gift < pack < grant, documented as distinct surfaces', () => {
    expect(MAX_GIFT_CREDITS).toBe(100_000_000);
    expect(MAX_PACK_CREDITS).toBe(1_000_000_000);
    expect(MAX_GRANT_CREDITS).toBe(100_000_000_000);
    expect(MAX_GIFT_CREDITS).toBeLessThan(MAX_PACK_CREDITS);
    expect(MAX_PACK_CREDITS).toBeLessThan(MAX_GRANT_CREDITS);
  });
});

describe('packSaleAmount / packPriceRial', () => {
  it('rounds the display amount up to the price step', () => {
    expect(packSaleAmount(2_000_000, 269_525, 1000)).toBe(540_000);
    expect(packSaleAmount(2_000_000, 270_000, 1000)).toBe(540_000);
  });

  it('converts toman to rials and rounds up to whole tens', () => {
    expect(packPriceRial(2_000_000, { code: 'IRT', rate: 269_500, priceStep: 1000 })).toBe(
      5_390_000,
    );
    expect(packPriceRial(1_000_000, { code: 'IRT', rate: 100.05 })).toBe(1_010);
    expect(packPriceRial(1_000_000, { code: 'USD', rate: 1 })).toBeNull();
  });
});
