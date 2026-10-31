import express from 'express';
import request from 'supertest';
import type { AppConfig } from '@librechat/data-schemas';
import { createApiRequestLimiter, readApiRateLimit } from './rateLimit';

function appWith(config: Record<string, unknown> | undefined, userId = 'user-1') {
  const app = express();
  app.use((req, _res, next) => {
    Object.assign(req, { config, user: { id: userId } });
    next();
  });
  app.post('/chat/completions', createApiRequestLimiter(), (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe('readApiRateLimit', () => {
  it('reads rateLimits.api, with a one-minute window by default', () => {
    expect(
      readApiRateLimit({ rateLimits: { api: { userMax: 5 } } } as unknown as AppConfig),
    ).toEqual({ max: 5, windowMinutes: 1 });
    expect(readApiRateLimit({} as AppConfig)).toBeNull();
    expect(
      readApiRateLimit({ rateLimits: { api: { userMax: 0 } } } as unknown as AppConfig),
    ).toBeNull();
  });
});

describe('createApiRequestLimiter', () => {
  it('lets every call through without rateLimits.api', async () => {
    const app = appWith(undefined);
    for (let i = 0; i < 5; i++) {
      const response = await request(app).post('/chat/completions');
      expect(response.status).toBe(200);
    }
  });

  it('refuses calls past the limit with an OpenAI-shaped 429 and Retry-After', async () => {
    const app = appWith({ rateLimits: { api: { userMax: 2, userWindowInMinutes: 1 } } });
    await request(app).post('/chat/completions').expect(200);
    await request(app).post('/chat/completions').expect(200);
    const refused = await request(app).post('/chat/completions').expect(429);
    expect(refused.body.error).toMatchObject({
      type: 'rate_limit_error',
      code: 'rate_limit_exceeded',
    });
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
  });
});
