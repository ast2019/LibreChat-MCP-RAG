import express from 'express';
import request from 'supertest';
import type { AppConfig } from '@librechat/data-schemas';
import { createPaymentCallbackLimiter, readPaymentCallbackRateLimit } from './limiter';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));

const withLimit = (paymentCallback: unknown) =>
  ({ rateLimits: { paymentCallback } }) as unknown as AppConfig;

function appWith(getConfig: () => Promise<AppConfig | undefined>) {
  const app = express();
  app.set('trust proxy', true);
  const onLimited = jest.fn((_req: express.Request, res: express.Response) =>
    res.redirect(303, '/payment/result?status=pending&code=rate_limited'),
  );
  const callback = jest.fn((_req: express.Request, res: express.Response) => res.sendStatus(204));
  app.get('/callback/:gateway', createPaymentCallbackLimiter({ getConfig, onLimited }), callback);
  return { app, onLimited, callback };
}

describe('readPaymentCallbackRateLimit', () => {
  it('defaults to 60 returns per minute and reads rateLimits.paymentCallback', () => {
    expect(readPaymentCallbackRateLimit(undefined)).toEqual({ max: 60, windowMinutes: 1 });
    expect(readPaymentCallbackRateLimit(withLimit({ ipMax: 5, ipWindowInMinutes: 10 }))).toEqual({
      max: 5,
      windowMinutes: 10,
    });
    expect(readPaymentCallbackRateLimit(withLimit({ ipMax: 0 }))).toEqual({
      max: 60,
      windowMinutes: 1,
    });
  });
});

describe('createPaymentCallbackLimiter', () => {
  it('lets a burst of real returns through by default', async () => {
    const { app, onLimited } = appWith(async () => undefined);
    for (let i = 0; i < 20; i++) {
      await request(app).get('/callback/zarinpal').set('X-Forwarded-For', '5.6.7.8').expect(204);
    }
    expect(onLimited).not.toHaveBeenCalled();
  });

  it('refuses returns past the limit per address, with Retry-After, without calling the handler', async () => {
    const { app, onLimited, callback } = appWith(async () => withLimit({ ipMax: 2 }));
    const from = (ip: string) => request(app).get('/callback/zarinpal').set('X-Forwarded-For', ip);
    await from('1.2.3.4').expect(204);
    await from('1.2.3.4').expect(204);

    const refused = await from('1.2.3.4');

    expect(refused.status).toBe(303);
    expect(refused.headers.location).toContain('code=rate_limited');
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    expect(onLimited).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledTimes(2);
    /** Another address has its own budget */
    await from('9.9.9.9').expect(204);
  });

  it('falls back to the default when the config cannot be read', async () => {
    const { app } = appWith(async () => {
      throw new Error('config down');
    });
    await request(app).get('/callback/idpay').expect(204);
  });
});
