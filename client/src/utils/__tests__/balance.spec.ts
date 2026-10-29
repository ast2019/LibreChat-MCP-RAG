import type { TBalanceResponse } from 'librechat-data-provider';
import {
  formatPackUsd,
  summarizeBalance,
  formatPackPrice,
  formatTimeUntil,
  formatBalanceAmount,
} from '../balance';

const refilling = (over: Partial<TBalanceResponse> = {}): TBalanceResponse => ({
  tokenCredits: 12_400,
  autoRefillEnabled: true,
  refillAmount: 20_000,
  refillIntervalValue: 7,
  refillIntervalUnit: 'days',
  lastRefill: '2026-07-01T00:00:00.000Z',
  ...over,
});

describe('summarizeBalance', () => {
  it('measures spend against the refill amount under auto-refill', () => {
    const summary = summarizeBalance(refilling(), { display: 'credits', startBalance: 50_000 });
    expect(summary.allotment).toBe(20_000);
    expect(summary.usedPercent).toBe(38);
    expect(summary.tone).toBe('normal');
    expect(summary.refillAmount).toBe(20_000);
    expect(summary.nextRefill?.toISOString()).toBe('2026-07-08T00:00:00.000Z');
  });

  it('falls back to the starting balance without auto-refill', () => {
    const summary = summarizeBalance(
      { tokenCredits: 5_000, autoRefillEnabled: false },
      { display: 'percent', startBalance: 20_000 },
    );
    expect(summary.allotment).toBe(20_000);
    expect(summary.usedPercent).toBe(75);
    expect(summary.refillAmount).toBeNull();
    expect(summary.nextRefill).toBeNull();
  });

  it('measures spend against the last granted pack before refill or starting balance', () => {
    const summary = summarizeBalance(
      refilling({ tokenCredits: 500_000, packAllotment: 2_000_000, packLabel: ' Starter ' }),
      { display: 'percent', startBalance: 200_000 },
    );
    expect(summary.allotment).toBe(2_000_000);
    expect(summary.usedPercent).toBe(75);
    expect(summary.packLabel).toBe('Starter');
  });

  it('ignores an unusable pack allotment and a blank pack label', () => {
    const summary = summarizeBalance(
      { tokenCredits: 5_000, autoRefillEnabled: false, packAllotment: 0, packLabel: '  ' },
      { display: 'percent', startBalance: 20_000 },
    );
    expect(summary.allotment).toBe(20_000);
    expect(summary.packLabel).toBeNull();
  });

  it('has no percent without an allotment to measure against', () => {
    const summary = summarizeBalance({ tokenCredits: 5_000, autoRefillEnabled: false });
    expect(summary.display).toBe('credits');
    expect(summary.usedPercent).toBeNull();
    expect(summary.tone).toBe('normal');
  });

  it('reads 0% used when saved-up credits exceed the allotment', () => {
    const summary = summarizeBalance(refilling({ tokenCredits: 45_000 }));
    expect(summary.usedPercent).toBe(0);
  });

  it('never reads 100% used while credits remain', () => {
    const summary = summarizeBalance(refilling({ tokenCredits: 1 }));
    expect(summary.usedPercent).toBe(99);
    expect(summary.tone).toBe('warning');
  });

  it('warns from 90% spent and is empty at zero credits', () => {
    expect(summarizeBalance(refilling({ tokenCredits: 2_000 })).tone).toBe('warning');
    expect(summarizeBalance(refilling({ tokenCredits: 2_001 })).tone).toBe('normal');
    const empty = summarizeBalance(refilling({ tokenCredits: 0 }));
    expect(empty.usedPercent).toBe(100);
    expect(empty.tone).toBe('danger');
  });

  it('is empty without an allotment once credits run out', () => {
    const empty = summarizeBalance({ tokenCredits: -5, autoRefillEnabled: false });
    expect(empty.tone).toBe('danger');
    expect(empty.usedPercent).toBe(100);
  });

  it('drops an unreadable last-refill date instead of inventing one', () => {
    expect(summarizeBalance(refilling({ lastRefill: 'not a date' })).nextRefill).toBeNull();
  });
});

describe('formatBalanceAmount', () => {
  it('formats credits without hiding fractional differences', () => {
    expect(formatBalanceAmount(3_100_000, 'credits')).toBe('3,100,000');
    expect(formatBalanceAmount(100.4, 'credits')).toBe('100.4');
    expect(formatBalanceAmount(100.3, 'credits')).toBe('100.3');
    expect(formatBalanceAmount(12_480.656, 'credits')).toBe('12,480.66');
  });

  it('converts credits to money at one million credits per dollar', () => {
    expect(formatBalanceAmount(3_100_000, 'currency')).toBe('$3.10');
    expect(formatBalanceAmount(5_000_000, 'currency', { code: 'EUR', rate: 0.5 })).toBe('€2.50');
  });
});

describe('formatTimeUntil', () => {
  const now = Date.parse('2026-10-05T00:00:00.000Z');
  const at = (ms: number) => new Date(now + ms);

  it('picks minutes, hours, then days', () => {
    expect(formatTimeUntil(at(5 * 60_000), now, 'en')).toBe('in 5 minutes');
    expect(formatTimeUntil(at(3 * 3_600_000), now, 'en')).toBe('in 3 hours');
    expect(formatTimeUntil(at(3 * 86_400_000), now, 'en')).toBe('in 3 days');
  });

  it('is null once the moment has passed', () => {
    expect(formatTimeUntil(at(0), now, 'en')).toBeNull();
    expect(formatTimeUntil(at(-1), now, 'en')).toBeNull();
  });
});

describe('pack display', () => {
  const toman = { code: 'IRT', rate: 269_500, priceStep: 1000 };

  it('reads as the share of the trial used, with prices, before a pack is granted', () => {
    const summary = summarizeBalance(
      { tokenCredits: 150_000, autoRefillEnabled: false },
      { display: 'pack', startBalance: 200_000 },
    );
    expect(summary.display).toBe('percent');
    expect(summary.usedPercent).toBe(25);
    expect(summary.showPrices).toBe(true);
  });

  it('reads as the share of the pack used once a pack is granted, without money or prices', () => {
    const summary = summarizeBalance(
      {
        tokenCredits: 1_500_000,
        autoRefillEnabled: false,
        packAllotment: 2_000_000,
        packLabel: 'Starter',
      },
      { display: 'pack', startBalance: 200_000 },
    );
    expect(summary.display).toBe('percent');
    expect(summary.usedPercent).toBe(25);
    expect(summary.showPrices).toBe(false);
  });

  it('offers the prices again once the pack is spent', () => {
    const summary = summarizeBalance(
      { tokenCredits: 0, autoRefillEnabled: false, packAllotment: 2_000_000 },
      { display: 'pack' },
    );
    expect(summary.showPrices).toBe(true);
    expect(summary.tone).toBe('danger');
  });

  it('formats the pack mode as money', () => {
    expect(formatBalanceAmount(1_000_000, 'pack', toman)).toBe('۲۶۹٬۵۰۰ تومان');
  });
});

describe('formatPackPrice', () => {
  it('rounds the Toman price up to the price step', () => {
    expect(formatPackPrice(2_000_000, { code: 'IRT', rate: 269_525, priceStep: 1000 })).toBe(
      '۵۴۰٬۰۰۰ تومان',
    );
  });

  it('keeps an exact multiple instead of rounding it up a step', () => {
    expect(formatPackPrice(2_000_000, { code: 'IRT', rate: 270_000, priceStep: 1000 })).toBe(
      '۵۴۰٬۰۰۰ تومان',
    );
  });

  it('formats ISO currencies and shows nothing without a usable rate', () => {
    expect(formatPackPrice(5_000_000, { code: 'EUR', rate: 0.5 })).toBe('€2.50');
    expect(formatPackPrice(5_000_000, undefined)).toBeNull();
    expect(formatPackPrice(5_000_000, { code: 'IRT', rate: 0 })).toBeNull();
  });
});

describe('formatPackUsd', () => {
  it('states a pack in dollars of usage, in the page digits', () => {
    expect(formatPackUsd(4_000_000, 'en')).toBe('4');
    expect(formatPackUsd(2_500_000, 'en')).toBe('2.5');
    expect(formatPackUsd(30_000_000, 'fa')).toBe('۳۰');
  });
});
