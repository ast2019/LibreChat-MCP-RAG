import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { PhoneAuthErrorCode } from 'librechat-data-provider';
import { createMethods, createModels } from '@librechat/data-schemas';
import type { NextFunction, Request, Response } from 'express';
import type { AppConfig } from '@librechat/data-schemas';
import type { PhoneAuthHandlersDeps, PhoneRequest } from './handlers';
import type { OtpStore, SmsProvider } from './types';
import { createPhoneAuthHandlers } from './handlers';
import { createPhoneLimiters } from './limiter';

let mongoServer: MongoMemoryServer;
let methods: ReturnType<typeof createMethods>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  await mongoose.models.User.syncIndexes();
  methods = createMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.models.User.deleteMany({});
  await mongoose.models.Balance.deleteMany({});
});

function memoryStore(): OtpStore {
  const map = new Map<string, unknown>();
  return {
    get: async (key) => map.get(key),
    set: async (key, value) => map.set(key, value),
    delete: async (key) => map.delete(key),
  };
}

interface Options {
  allowRegistration?: boolean;
  enabled?: boolean;
  apiKey?: string;
}

function buildApp(options: Options = {}) {
  const sent: Array<{ phone: string; code: string }> = [];
  const sms: SmsProvider = {
    sendCode: jest.fn(async (input) => {
      sent.push(input);
      return { ok: true } as const;
    }),
  };
  const appConfig = {
    registration: {
      phone: {
        enabled: options.enabled ?? true,
        template: 'hive-login',
        allowRegistration: options.allowRegistration ?? true,
      },
    },
    balance: { enabled: true, startBalance: 5000 },
  } as unknown as AppConfig;
  const store = memoryStore();
  const checkBan = jest.fn(async (_req: PhoneRequest, _res: Response, next: () => void) => next());

  const deps: PhoneAuthHandlersDeps = {
    env: { KAVENEGAR_API_KEY: options.apiKey ?? 'key' },
    getAppConfig: async () => appConfig,
    getStore: () => store,
    secret: 'test-secret',
    createSmsProvider: () => sms,
    findUserByPhone: (phone) =>
      methods.findUser({ phone }) as unknown as ReturnType<
        PhoneAuthHandlersDeps['findUserByPhone']
      >,
    getUserById: methods.getUserById as unknown as PhoneAuthHandlersDeps['getUserById'],
    createUserIfAbsent: methods.createUserIfAbsent,
    countUsers: () => methods.countUsers(),
    getTenantId: () => undefined,
    updateUser: methods.updateUser as unknown as PhoneAuthHandlersDeps['updateUser'],
    unsetUserPhone: methods.unsetUserPhone as unknown as PhoneAuthHandlersDeps['unsetUserPhone'],
    comparePassword: async (user, candidate) => user.password === `hashed:${candidate}`,
    checkBan,
    pad: async () => undefined,
  };
  const handlers = createPhoneAuthHandlers(deps);
  const limiters = createPhoneLimiters({
    limiterCache: () => undefined,
    removePorts: (req) => req.ip,
    logViolation: jest.fn(async () => undefined),
    resolveLimits: handlers.resolveLimits,
  });

  const app = express();
  app.use(express.json());
  const fakeLogin = (req: Request, res: Response) => {
    res.status(200).json({ token: 'jwt', user: (req as PhoneRequest).user });
  };
  const fakeAuth = async (req: Request, _res: Response, next: NextFunction) => {
    const id = req.headers['x-user'];
    if (typeof id === 'string') {
      const user = await methods.getUserById(id);
      (req as PhoneRequest).user = { ...(user as object), id } as PhoneRequest['user'];
    }
    next();
  };
  app.post(
    '/auth/phone/request',
    limiters.phoneCodeRequestLimiter,
    handlers.requestLoginCode as unknown as express.RequestHandler,
  );
  app.post(
    '/auth/phone/verify',
    limiters.phoneCodeVerifyLimiter,
    handlers.verifyLoginCode as unknown as express.RequestHandler,
    fakeLogin,
  );
  app.post('/user/phone', fakeAuth, handlers.requestLinkCode as unknown as express.RequestHandler);
  app.post(
    '/user/phone/verify',
    fakeAuth,
    handlers.verifyLinkCode as unknown as express.RequestHandler,
  );
  app.delete('/user/phone', fakeAuth, handlers.removePhone as unknown as express.RequestHandler);
  app.patch('/user/profile', fakeAuth, handlers.updateProfile as unknown as express.RequestHandler);
  return { app, sent, sms, checkBan };
}

const PHONE = '+989121234567';

describe('phone sign-in routes', () => {
  it('404s with a stable code when phone sign-in is off or has no provider key', async () => {
    const { app } = buildApp({ enabled: false });
    const res = await request(app).post('/auth/phone/request').send({ phone: '09121234567' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ code: PhoneAuthErrorCode.DISABLED });

    const noKey = buildApp({ apiKey: '' });
    const res2 = await request(noKey.app)
      .post('/auth/phone/request')
      .send({ phone: '09121234567' });
    expect(res2.status).toBe(404);
  });

  it('rejects an invalid number', async () => {
    const { app, sent } = buildApp();
    const res = await request(app).post('/auth/phone/request').send({ phone: '0212345' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ code: PhoneAuthErrorCode.INVALID_PHONE });
    expect(sent).toHaveLength(0);
  });

  it('registers a new number with the start balance and signs it in', async () => {
    const { app, sent, checkBan } = buildApp();
    const req1 = await request(app).post('/auth/phone/request').send({ phone: '۰۹۱۲۱۲۳۴۵۶۷' });
    expect(req1.status).toBe(200);
    expect(req1.body).toEqual({
      sent: true,
      cooldownSeconds: 60,
      expiresInSeconds: 120,
      codeLength: 6,
    });
    expect(sent[0].phone).toBe(PHONE);

    const res = await request(app)
      .post('/auth/phone/verify')
      .send({ phone: '09121234567', code: sent[0].code, name: '  سارا\u0007 ' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ phone: PHONE, phoneVerified: true, name: 'سارا' });
    expect(res.body.user.email).toBeUndefined();
    expect(checkBan).toHaveBeenCalled();

    const balance = await mongoose.models.Balance.findOne({ user: res.body.user._id }).lean();
    expect(balance).toMatchObject({ tokenCredits: 5000 });
  });

  it('signs in an existing account without creating another', async () => {
    const existing = await methods.createUser({
      email: 'a@example.com',
      phone: PHONE,
      phoneVerified: true,
      provider: 'local',
    });
    const { app, sent } = buildApp({ allowRegistration: false });
    await request(app).post('/auth/phone/request').send({ phone: PHONE });
    const res = await request(app)
      .post('/auth/phone/verify')
      .send({ phone: PHONE, code: sent[0].code });
    expect(res.status).toBe(200);
    expect(String(res.body.user._id)).toBe(String(existing));
    expect(await mongoose.models.User.countDocuments()).toBe(1);
  });

  it('answers identically for an unknown number when registration is closed, sending nothing', async () => {
    await methods.createUser({ phone: '+989121111111', phoneVerified: true, provider: 'local' });
    const { app, sent } = buildApp({ allowRegistration: false });
    const known = await request(app).post('/auth/phone/request').send({ phone: '09121111111' });
    const unknown = await request(app).post('/auth/phone/request').send({ phone: '09129999999' });
    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
    expect(sent.map((s) => s.phone)).toEqual(['+989121111111']);

    const verify = await request(app)
      .post('/auth/phone/verify')
      .send({ phone: '09129999999', code: '123456' });
    expect(verify.status).toBe(400);
    expect(verify.body).toEqual({ code: PhoneAuthErrorCode.EXPIRED });
  });

  it('refuses non-local accounts holding the number', async () => {
    await methods.createUser({
      email: 'o@example.com',
      phone: PHONE,
      phoneVerified: true,
      provider: 'openid',
    });
    const { app, sent } = buildApp({ allowRegistration: false });
    await request(app).post('/auth/phone/request').send({ phone: PHONE });
    expect(sent).toHaveLength(0);
  });

  it('reports wrong codes, then locks after max attempts', async () => {
    const { app, sent } = buildApp();
    await request(app).post('/auth/phone/request').send({ phone: PHONE });
    const wrong = sent[0].code === '000000' ? '111111' : '000000';
    const first = await request(app).post('/auth/phone/verify').send({ phone: PHONE, code: wrong });
    expect(first.status).toBe(400);
    expect(first.body).toEqual({ code: PhoneAuthErrorCode.INVALID_CODE, attemptsRemaining: 4 });
    for (let i = 0; i < 3; i++) {
      await request(app).post('/auth/phone/verify').send({ phone: PHONE, code: wrong });
    }
    const locked = await request(app)
      .post('/auth/phone/verify')
      .send({ phone: PHONE, code: wrong });
    expect(locked.status).toBe(429);
    expect(locked.body).toEqual({ code: PhoneAuthErrorCode.TOO_MANY_ATTEMPTS });
  });

  it('enforces the cooldown and the per-number hourly limit', async () => {
    const { app } = buildApp();
    await request(app).post('/auth/phone/request').send({ phone: PHONE });
    const again = await request(app).post('/auth/phone/request').send({ phone: PHONE });
    expect(again.status).toBe(429);
    expect(again.body.code).toBe(PhoneAuthErrorCode.COOLDOWN);
    expect(again.body.retryAfterSeconds).toBeGreaterThan(0);

    for (let i = 0; i < 3; i++) {
      await request(app).post('/auth/phone/request').send({ phone: PHONE });
    }
    const limited = await request(app).post('/auth/phone/request').send({ phone: PHONE });
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe(PhoneAuthErrorCode.RATE_LIMITED);
  });

  it('stops before token issuance for a banned account', async () => {
    const { app, sent, checkBan } = buildApp();
    checkBan.mockImplementation(async (req: PhoneRequest, res: Response) => {
      req.banned = true;
      res.status(403).json({ message: 'banned' });
    });
    await request(app).post('/auth/phone/request').send({ phone: PHONE });
    const res = await request(app)
      .post('/auth/phone/verify')
      .send({ phone: PHONE, code: sent[0].code });
    expect(res.status).toBe(403);
    expect(res.body.token).toBeUndefined();
  });
});

describe('phone linking routes', () => {
  it('links a verified number to the signed-in account', async () => {
    const id = String(await methods.createUser({ email: 'b@example.com', provider: 'local' }));
    const { app, sent } = buildApp();
    const req1 = await request(app)
      .post('/user/phone')
      .set('x-user', id)
      .send({ phone: '9121234567' });
    expect(req1.status).toBe(200);
    const res = await request(app)
      .post('/user/phone/verify')
      .set('x-user', id)
      .send({ phone: PHONE, code: sent[0].code });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ phone: PHONE, phoneVerified: true });
    expect(await methods.getUserById(id)).toMatchObject({ phone: PHONE, phoneVerified: true });
  });

  it('requires the password when the account has one', async () => {
    const id = String(
      await methods.createUser({
        email: 'c@example.com',
        provider: 'local',
        password: 'hashed:pw12345678',
      }),
    );
    const { app, sent } = buildApp();
    const denied = await request(app).post('/user/phone').set('x-user', id).send({ phone: PHONE });
    expect(denied.status).toBe(403);
    expect(denied.body).toEqual({ code: PhoneAuthErrorCode.PASSWORD_INVALID });
    expect(sent).toHaveLength(0);
    const ok = await request(app)
      .post('/user/phone')
      .set('x-user', id)
      .send({ phone: PHONE, password: 'pw12345678' });
    expect(ok.status).toBe(200);
  });

  it('refuses a number held by another account, only after proof of possession', async () => {
    await methods.createUser({ phone: PHONE, phoneVerified: true, provider: 'local' });
    const id = String(await methods.createUser({ email: 'd@example.com', provider: 'local' }));
    const { app, sent } = buildApp();
    const req1 = await request(app).post('/user/phone').set('x-user', id).send({ phone: PHONE });
    expect(req1.status).toBe(200);
    const wrong = await request(app)
      .post('/user/phone/verify')
      .set('x-user', id)
      .send({ phone: PHONE, code: sent[0].code === '000000' ? '111111' : '000000' });
    expect(wrong.body.code).toBe(PhoneAuthErrorCode.INVALID_CODE);
    const res = await request(app)
      .post('/user/phone/verify')
      .set('x-user', id)
      .send({ phone: PHONE, code: sent[0].code });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: PhoneAuthErrorCode.PHONE_IN_USE });
  });

  it('removes the number only when an email remains', async () => {
    const phoneOnly = String(
      await methods.createUser({ phone: PHONE, phoneVerified: true, provider: 'local' }),
    );
    const both = String(
      await methods.createUser({
        email: 'e@example.com',
        phone: '+989121111111',
        phoneVerified: true,
        provider: 'local',
      }),
    );
    const { app } = buildApp();
    const refused = await request(app).delete('/user/phone').set('x-user', phoneOnly);
    expect(refused.status).toBe(400);
    expect(refused.body).toEqual({ code: PhoneAuthErrorCode.ONLY_IDENTIFIER });

    const removed = await request(app).delete('/user/phone').set('x-user', both);
    expect(removed.status).toBe(200);
    const user = await methods.getUserById(both);
    expect(user?.phone).toBeUndefined();
  });

  it('updates the display name', async () => {
    const id = String(await methods.createUser({ phone: PHONE, provider: 'local' }));
    const { app } = buildApp();
    const res = await request(app).patch('/user/profile').set('x-user', id).send({ name: ' نام ' });
    expect(res.status).toBe(200);
    expect((await methods.getUserById(id))?.name).toBe('نام');
    const bad = await request(app).patch('/user/profile').set('x-user', id).send({ name: '  ' });
    expect(bad.status).toBe(400);
  });
});

describe('user identity indexes', () => {
  it('allows many phone-only users but keeps phone and email unique', async () => {
    await methods.createUser({ phone: '+989120000001', provider: 'local' });
    await methods.createUser({ phone: '+989120000002', provider: 'local' });
    await expect(
      methods.createUser({ phone: '+989120000001', provider: 'local' }),
    ).rejects.toMatchObject({ code: 11000 });
    await methods.createUser({ email: 'x@example.com', provider: 'local' });
    await expect(
      methods.createUser({ email: 'x@example.com', provider: 'local' }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('requires email or phone', async () => {
    await expect(
      methods.createUser({ provider: 'local' } as unknown as Parameters<
        typeof methods.createUser
      >[0]),
    ).rejects.toThrow(/email or phone is required/);
  });

  it('createUserIfAbsent reports user_exists for a taken phone', async () => {
    await methods.createUser({ phone: PHONE, provider: 'local' });
    await expect(methods.createUserIfAbsent({ phone: PHONE, provider: 'local' })).resolves.toEqual({
      ok: false,
      error: { code: 'user_exists' },
    });
  });
});
