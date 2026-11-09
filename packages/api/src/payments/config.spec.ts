import type { AppConfig } from '@librechat/data-schemas';
import { getPaymentsStartupConfig, resolvePaymentSettings } from './config';
import { getPaymentGatewaysStatus } from './status';
import { createGatewayHealth } from './health';
import { getTehranWindows } from './handlers';
import { packPriceRial } from './pricing';

const withPayments = (payments: unknown) => ({ config: { payments } }) as unknown as AppConfig;

describe('resolvePaymentSettings', () => {
  it('is off by default', () => {
    const settings = resolvePaymentSettings(withPayments(undefined), {});
    expect(settings.enabled).toBe(false);
    expect(getPaymentsStartupConfig(withPayments(undefined), {})).toBeUndefined();
  });

  it('reads secrets only from payment env vars and defaults the callback to DOMAIN_SERVER', () => {
    const settings = resolvePaymentSettings(
      withPayments({
        enabled: true,
        gateways: {
          zarinpal: { enabled: true, merchantId: '${ZARINPAL_MERCHANT_ID}' },
          idpay: { enabled: true, apiKey: '${JWT_SECRET}' },
        },
      }),
      { ZARINPAL_MERCHANT_ID: 'm-1', JWT_SECRET: 'leak', DOMAIN_SERVER: 'https://hive.example/' },
    );
    expect(settings.callbackBaseUrl).toBe('https://hive.example');
    expect(settings.gateways.zarinpal.config).toEqual({
      merchantId: 'm-1',
      sandbox: false,
      currency: 'IRR',
    });
    expect(settings.gateways.idpay).toMatchObject({ configured: false });
    expect(settings.gateways.idpay.config).toBeUndefined();
  });

  it('treats an invalid block as disabled', () => {
    const settings = resolvePaymentSettings(
      withPayments({ enabled: true, orderTtlMinutes: 1 }),
      {},
    );
    expect(settings.enabled).toBe(false);
  });

  it('exposes only usable gateways to the client', () => {
    const config = withPayments({
      enabled: true,
      gateways: { zarinpal: { enabled: true, merchantId: 'm-1' }, idpay: { enabled: true } },
    });
    expect(getPaymentsStartupConfig(config, { DOMAIN_SERVER: 'https://hive.example' })).toEqual({
      enabled: true,
      gateways: ['zarinpal'],
    });
    expect(getPaymentsStartupConfig(config, {})).toBeUndefined();
  });
});

describe('getPaymentGatewaysStatus', () => {
  it('reports configuration and the last call outcomes without secrets', () => {
    const health = createGatewayHealth(() => new Date('2025-01-01T10:00:00Z'));
    health.recordFailure('zarinpal', 'gateway_unreachable');
    const rows = getPaymentGatewaysStatus(
      withPayments({
        enabled: true,
        gateways: { zarinpal: { enabled: true, merchantId: 'secret-m', sandbox: true } },
      }),
      {
        env: { DOMAIN_SERVER: 'https://hive.example' },
        health,
        activity: [{ gateway: 'zarinpal', lastPaidAt: new Date('2025-01-01T09:00:00Z') }],
      },
    );
    expect(rows).toEqual([
      {
        id: 'zarinpal',
        enabled: true,
        configured: true,
        sandbox: true,
        usable: true,
        lastSuccessAt: '2025-01-01T09:00:00.000Z',
        lastFailureAt: '2025-01-01T10:00:00.000Z',
        lastFailureCode: 'gateway_unreachable',
        healthy: false,
        errorCode: 'gateway_unreachable',
      },
      {
        id: 'idpay',
        enabled: false,
        configured: false,
        sandbox: false,
        usable: false,
        healthy: false,
        errorCode: 'not_enabled',
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain('secret-m');
  });
});

describe('packPriceRial', () => {
  it('matches the displayed toman price, in rials', () => {
    expect(packPriceRial(2_000_000, { code: 'IRT', rate: 269_500, priceStep: 1000 })).toBe(
      5_390_000,
    );
    expect(packPriceRial(15_000_000, { code: 'IRT', rate: 269_500, priceStep: 1000 })).toBe(
      40_430_000,
    );
  });
  it('rounds rial prices up to the step and to whole tens', () => {
    expect(packPriceRial(1_000_000, { code: 'IRR', rate: 1_000_001 })).toBe(1_000_010);
  });
  it('refuses currencies a gateway cannot charge', () => {
    expect(packPriceRial(1_000_000, { code: 'USD', rate: 1 })).toBeNull();
    expect(packPriceRial(1_000_000, undefined)).toBeNull();
  });
});

describe('getTehranWindows', () => {
  it('starts today at Tehran midnight and the month on the 1st of the Persian month', () => {
    /** 2025-03-25 12:00 UTC is 5 Farvardin 1404, 15:30 in Tehran */
    const { todaySince, monthSince } = getTehranWindows(new Date('2025-03-25T12:00:00Z'));
    expect(todaySince.toISOString()).toBe('2025-03-24T20:30:00.000Z');
    expect(monthSince.toISOString()).toBe('2025-03-20T20:30:00.000Z');
  });

  it('starts the month on the first of the Persian month, not the Gregorian one', () => {
    /** 2026-11-09 is 18 Aban 1405; Aban started on 23 October 2026. */
    const { monthSince } = getTehranWindows(new Date('2026-11-09T12:00:00Z'));
    expect(monthSince.toISOString()).toBe('2026-10-22T20:30:00.000Z');
  });

  it('moves the month boundary with the Persian month, not the Gregorian one', () => {
    /** The last day of Shahrivar 1405 (22 September) still counts as the same month. */
    const before = getTehranWindows(new Date('2026-09-22T12:00:00Z'));
    expect(before.monthSince.toISOString()).toBe('2026-08-22T20:30:00.000Z');
    /** The first day of Mehr 1405 (23 September) starts a new month. */
    const after = getTehranWindows(new Date('2026-09-23T12:00:00Z'));
    expect(after.monthSince.toISOString()).toBe('2026-09-22T20:30:00.000Z');
  });

  it('agrees with the platform calendar on every day of a Persian month', () => {
    /** The platform's own Persian calendar, read the way the old implementation read it. */
    const persianDay = new Intl.DateTimeFormat('en-US-u-ca-persian', {
      day: 'numeric',
      timeZone: 'Asia/Tehran',
    });
    /** 23 September 2026 is 1 Mehr 1405; noon UTC keeps it the same Tehran day. */
    const monthStart = Date.UTC(2026, 8, 23);
    for (let day = 1; day <= 30; day += 1) {
      const now = new Date(monthStart + (day - 1) * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000);
      const { todaySince, monthSince } = getTehranWindows(now);
      const expectedDay = Number.parseInt(persianDay.format(now).replace(/\D/g, ''), 10);
      expect(expectedDay).toBe(day);
      /** The month window never moves while the month does. */
      expect(monthSince.toISOString()).toBe('2026-09-22T20:30:00.000Z');
      /** Tehran midnight is 3.5 hours before UTC midnight. */
      expect(todaySince.toISOString()).toBe(
        new Date(monthStart + (day - 1) * 24 * 60 * 60 * 1000 - 3.5 * 60 * 60 * 1000).toISOString(),
      );
    }
  });
});
