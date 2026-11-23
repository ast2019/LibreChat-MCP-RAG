jest.mock('~/cache/getLogStores');

const mockGetAppConfig = jest.fn();
jest.mock('~/server/services/Config', () => ({
  getAppConfig: (...args) => mockGetAppConfig(...args),
}));

jest.mock('~/server/middleware', () => ({
  requireJwtAuth: (_req, res) => res.sendStatus(401),
}));

jest.mock(
  '~/server/middleware/limiters/paymentCheckoutLimiter',
  () => (_req, _res, next) => next(),
);

jest.mock('~/server/middleware/roles/capabilities', () => ({
  requireCapability: () => (_req, res) => res.sendStatus(403),
}));

const mockFindPaymentOrderById = jest.fn();
jest.mock('~/models', () => ({
  findPaymentOrderById: (...args) => mockFindPaymentOrderById(...args),
}));

const request = require('supertest');
const express = require('express');
const paymentsRoute = require('../payments');

function createApp() {
  const app = express();
  app.set('trust proxy', true);
  app.use('/api/payments', paymentsRoute);
  return app;
}

describe('payment callback rate limit', () => {
  beforeEach(() => {
    mockGetAppConfig.mockResolvedValue({ rateLimits: { paymentCallback: { ipMax: 2 } } });
    mockFindPaymentOrderById.mockResolvedValue(null);
  });

  it('sends a source address past the limit to the pending result page without a lookup', async () => {
    const app = createApp();
    const orderId = '6b036f267c98a73c34aa27c7';
    const call = () =>
      request(app)
        .get(`/api/payments/callback/zarinpal?order=${orderId}&Authority=A1&Status=OK`)
        .set('X-Forwarded-For', '203.0.113.9');

    expect((await call()).headers.location).toContain('code=invalid_callback');
    expect((await call()).headers.location).toContain('code=invalid_callback');
    const refused = await call();

    expect(refused.status).toBe(303);
    expect(refused.headers.location).toBe(
      `/payment/result?status=pending&order=${orderId}&code=rate_limited`,
    );
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    expect(mockFindPaymentOrderById).toHaveBeenCalledTimes(2);
  });
});
