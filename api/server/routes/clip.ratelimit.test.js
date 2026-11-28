const express = require('express');
const request = require('supertest');

const mockWizard = {
  config: jest.fn(async () => ({ status: 200, body: { ok: true } })),
  validate: jest.fn(async () => ({ status: 200, body: { ok: true } })),
  voiceSample: jest.fn(async () => ({ status: 200, body: { ok: true } })),
  styleSample: jest.fn(async () => ({ status: 200, body: { ok: true } })),
  preview: jest.fn(async () => ({ status: 200, body: { ok: true } })),
  render: jest.fn(async () => ({ status: 200, body: { ok: true } })),
  draft: jest.fn(async () => ({ status: 200, body: { ok: true } })),
  chat: jest.fn(async () => ({ status: 200, body: { ok: true } })),
  estimate: jest.fn(async () => ({ status: 200, body: { ok: true } })),
};

jest.mock('@librechat/data-schemas', () => ({ logger: { error: jest.fn() } }));
jest.mock('@librechat/api', () => ({ limiterCache: () => undefined }));
jest.mock('~/server/middleware', () => ({
  requireJwtAuth: (req, res, next) => {
    req.user = { id: req.headers['x-user'] || 'u1' };
    next();
  },
  configMiddleware: (req, res, next) => next(),
}));
jest.mock('~/server/services/Clip', () => ({ clipWizard: mockWizard }));

describe('clip wizard rate limits', () => {
  let app;

  beforeEach(() => {
    jest.resetModules();
    process.env.CLIP_WIZARD_MAX = '5';
    process.env.CLIP_WIZARD_SAMPLE_MAX = '2';
    process.env.CLIP_WIZARD_LLM_MAX = '2';
    process.env.CLIP_WIZARD_PREVIEW_MAX = '2';
    Object.values(mockWizard).forEach((fn) => fn.mockClear());
    app = express();
    app.use(express.json());
    app.use('/api/clip', require('./clip'));
  });

  afterEach(() => {
    delete process.env.CLIP_WIZARD_MAX;
    delete process.env.CLIP_WIZARD_SAMPLE_MAX;
    delete process.env.CLIP_WIZARD_LLM_MAX;
    delete process.env.CLIP_WIZARD_PREVIEW_MAX;
  });

  it('answers 429 rate_limited on voice-sample past its cap, without calling the provider path', async () => {
    const send = () => request(app).post('/api/clip/wizard/voice-sample').send({ voiceId: 'v' });
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    const blocked = await send();
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: { code: 'rate_limited' } });
    expect(mockWizard.voiceSample).toHaveBeenCalledTimes(2);
  });

  it('caps validate per user and leaves other users alone', async () => {
    const send = (user) =>
      request(app).post('/api/clip/wizard/storyboard/validate').set('x-user', user).send({});
    for (let i = 0; i < 5; i += 1) {
      expect((await send('a')).status).toBe(200);
    }
    expect((await send('a')).status).toBe(429);
    expect((await send('b')).status).toBe(200);
    expect(mockWizard.validate).toHaveBeenCalledTimes(6);
  });

  it('caps draft and chat together per user, before the model is called', async () => {
    const draft = () => request(app).post('/api/clip/wizard/draft').send({});
    const chat = () => request(app).post('/api/clip/wizard/chat').send({});
    expect((await draft()).status).toBe(200);
    expect((await chat()).status).toBe(200);
    const blocked = await draft();
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: { code: 'rate_limited' } });
    expect(mockWizard.draft).toHaveBeenCalledTimes(1);
    expect(mockWizard.chat).toHaveBeenCalledTimes(1);
  });

  it('caps previews per user before the worker is called, and serves style samples under the general cap only', async () => {
    const preview = () => request(app).post('/api/clip/wizard/preview').send({});
    expect((await preview()).status).toBe(200);
    expect((await preview()).status).toBe(200);
    const blocked = await preview();
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: { code: 'rate_limited' } });
    expect(mockWizard.preview).toHaveBeenCalledTimes(2);
    const style = () => request(app).post('/api/clip/wizard/style-sample').send({});
    expect((await style()).status).toBe(200);
    expect((await style()).status).toBe(200);
    expect(mockWizard.styleSample).toHaveBeenCalledTimes(2);
  });
});
