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
});
