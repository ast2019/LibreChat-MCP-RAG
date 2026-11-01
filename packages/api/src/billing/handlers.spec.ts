import type { Response } from 'express';
import type { AdminBalanceDeps } from './handlers';
import { createAdminBalanceHandlers, getAllotmentUsedPercent } from './handlers';

const USER_ID = '507f1f77bcf86cd799439011';

function mockRes() {
  const res = {} as Response & { statusCode?: number; body?: unknown };
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  }) as unknown as Response['status'];
  res.json = jest.fn((body: unknown) => {
    res.body = body;
    return res;
  }) as unknown as Response['json'];
  return res;
}

function createDeps(over: Partial<AdminBalanceDeps> = {}): AdminBalanceDeps {
  return {
    getBalanceConfig: jest.fn().mockResolvedValue({
      enabled: true,
      packs: [{ id: 'starter', label: 'Starter', credits: 2_000_000 }],
    }),
    findUserByEmail: jest.fn().mockResolvedValue({ id: USER_ID, email: 'a@b.co' }),
    findUserById: jest.fn().mockResolvedValue({ id: USER_ID, email: 'a@b.co' }),
    findBalanceByUser: jest.fn().mockResolvedValue({ tokenCredits: 500_000, packAllotment: 2e6 }),
    createTransaction: jest.fn().mockResolvedValue({ balance: 2_000_000 }),
    upsertBalanceFields: jest.fn().mockResolvedValue({}),
    listUsersWithBalances: jest.fn().mockResolvedValue({
      total: 1,
      users: [
        {
          id: USER_ID,
          name: 'A',
          username: 'a',
          email: 'a@b.co',
          role: 'USER',
          balance: { tokenCredits: 250, packAllotment: 1000 },
        },
      ],
    }),
    getBillingSummary: jest.fn().mockResolvedValue({
      totalUsers: 3,
      activeUsers: 1,
      creditsGranted: 9e6,
      creditsGrantedInWindow: 2e6,
      packGrantsInWindow: 1,
      creditsSpentInWindow: 1.3e6,
      creditsOutstanding: 7e6,
      topModels: [],
    }),
    getPriceMultiplier: jest.fn().mockResolvedValue(1.3),
    now: () => new Date('2026-10-25T00:00:00.000Z'),
    ...over,
  };
}

const req = (body: unknown = {}, query: Record<string, unknown> = {}) =>
  ({ body, query, user: { id: 'admin-1' } }) as unknown as Parameters<
    ReturnType<typeof createAdminBalanceHandlers>['grant']
  >[0];

describe('createAdminBalanceHandlers.grant', () => {
  it('grants a pack to a user found by (normalized) email', async () => {
    const deps = createDeps();
    const res = mockRes();
    await createAdminBalanceHandlers(deps).grant(
      req({ email: ' A@B.co ', packId: 'starter' }),
      res,
    );

    expect(deps.findUserByEmail).toHaveBeenCalledWith('a@b.co');
    expect(deps.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ user: USER_ID, rawAmount: 2_000_000, context: 'pack' }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      user: { id: USER_ID },
      credits: 2_000_000,
      balance: 2_000_000,
      pack: { id: 'starter', label: 'Starter' },
    });
  });

  it('refuses while balance metering is disabled', async () => {
    const deps = createDeps({ getBalanceConfig: jest.fn().mockResolvedValue({ enabled: false }) });
    const res = mockRes();
    await createAdminBalanceHandlers(deps).grant(req({ userId: USER_ID, credits: 10 }), res);
    expect(res.statusCode).toBe(409);
    expect(deps.createTransaction).not.toHaveBeenCalled();
  });

  it.each([
    [{ userId: USER_ID, packId: 'nope' }, 404, 'pack_not_found'],
    [{ userId: USER_ID }, 400, 'grant_amount_required'],
    [{ packId: 'starter' }, 400, 'grant_target_required'],
    [{ userId: 'not-an-id', packId: 'starter' }, 400, 'invalid_user_id'],
  ])('rejects %p with %i %s', async (body, status, code) => {
    const deps = createDeps();
    const res = mockRes();
    await createAdminBalanceHandlers(deps).grant(req(body), res);
    expect(res.statusCode).toBe(status);
    expect(res.body).toEqual({ error: expect.objectContaining({ code }) });
    expect(deps.createTransaction).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown user', async () => {
    const deps = createDeps({ findUserById: jest.fn().mockResolvedValue(null) });
    const res = mockRes();
    await createAdminBalanceHandlers(deps).grant(req({ userId: USER_ID, credits: 10 }), res);
    expect(res.statusCode).toBe(404);
  });

  it('hides internal failure details behind a generic 500', async () => {
    const deps = createDeps({
      createTransaction: jest.fn().mockRejectedValue(new Error('mongo: secret detail')),
    });
    const res = mockRes();
    await createAdminBalanceHandlers(deps).grant(req({ userId: USER_ID, credits: 10 }), res);
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret detail');
  });
});

describe('createAdminBalanceHandlers.listPacks / getUserBalance', () => {
  it('lists configured packs', async () => {
    const res = mockRes();
    await createAdminBalanceHandlers(createDeps()).listPacks(req(), res);
    expect(res.body).toEqual({
      enabled: true,
      packs: [{ id: 'starter', label: 'Starter', credits: 2_000_000 }],
      startBalance: 0,
    });
  });

  it('reports the welcome gift new accounts get', async () => {
    const res = mockRes();
    const deps = createDeps({
      getBalanceConfig: jest.fn().mockResolvedValue({ enabled: true, startBalance: 200_000 }),
    });
    await createAdminBalanceHandlers(deps).listPacks(req(), res);
    expect(res.body).toMatchObject({ startBalance: 200_000 });
  });

  it('reports a user balance with the share of the pack used', async () => {
    const res = mockRes();
    await createAdminBalanceHandlers(createDeps()).getUserBalance(
      req({}, { email: 'a@b.co' }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      user: { id: USER_ID },
      balance: { tokenCredits: 500_000, packAllotment: 2e6, usedPercent: 75 },
    });
  });
});

describe('getAllotmentUsedPercent', () => {
  it('matches the client gauge rules', () => {
    expect(getAllotmentUsedPercent(null)).toBeNull();
    expect(getAllotmentUsedPercent({ tokenCredits: 0 })).toBe(100);
    expect(getAllotmentUsedPercent({ tokenCredits: 10 })).toBeNull();
    expect(getAllotmentUsedPercent({ tokenCredits: 1, packAllotment: 1000 })).toBe(99);
    expect(getAllotmentUsedPercent({ tokenCredits: 5000, packAllotment: 1000 })).toBe(0);
  });
});

describe('createAdminBalanceHandlers.listUsers / summary', () => {
  it('pages users with the share of their pack used', async () => {
    const deps = createDeps();
    const res = mockRes();
    await createAdminBalanceHandlers(deps).listUsers(
      req({}, { search: 'a', limit: '500', offset: '-3' }),
      res,
    );
    expect(deps.listUsersWithBalances).toHaveBeenCalledWith({ search: 'a', limit: 100, offset: 0 });
    expect(res.body).toMatchObject({ total: 1, users: [{ id: USER_ID, usedPercent: 75 }] });
  });

  it('summarizes a supported window and estimates provider cost from the multiplier', async () => {
    const deps = createDeps();
    const res = mockRes();
    await createAdminBalanceHandlers(deps).summary(req({}, { days: '7' }), res);
    expect(deps.getBillingSummary).toHaveBeenCalledWith({
      since: new Date('2026-10-18T00:00:00.000Z'),
    });
    expect(res.body).toMatchObject({
      days: 7,
      priceMultiplier: 1.3,
      estimatedProviderCredits: 1e6,
    });
  });

  it('keeps local OCR spend out of the provider cost', async () => {
    const deps = createDeps();
    (deps.getBillingSummary as jest.Mock).mockResolvedValueOnce({
      ...(await deps.getBillingSummary({ since: new Date() })),
      creditsSpentInWindow: 1.3e6 + 13_000,
      creditsSpentLocalInWindow: 13_000,
    });
    const res = mockRes();
    await createAdminBalanceHandlers(deps).summary(req({}, { days: '7' }), res);
    expect((res.body as { estimatedProviderCredits: number }).estimatedProviderCredits).toBeCloseTo(
      1e6,
    );
  });

  it('falls back to 30 days for an unsupported window', async () => {
    const res = mockRes();
    await createAdminBalanceHandlers(createDeps()).summary(req({}, { days: '365' }), res);
    expect(res.body).toMatchObject({ days: 30 });
  });
});

describe('createAdminBalanceHandlers.userUsage', () => {
  const usage = {
    totalCredits: 530_000,
    byContext: [
      { context: 'message', credits: 500_000, count: 12 },
      { context: 'memory', credits: 30_000, count: 12 },
    ],
    byModel: [{ model: 'm1', credits: 530_000 }],
  };

  it('reports one user’s spend for an allowed window', async () => {
    const getUserUsageByContext = jest.fn().mockResolvedValue(usage);
    const handlers = createAdminBalanceHandlers(createDeps({ getUserUsageByContext }));
    const res = mockRes();
    await handlers.userUsage(req({}, { userId: USER_ID, days: '7' }), res);

    expect(getUserUsageByContext).toHaveBeenCalledWith({
      userId: USER_ID,
      since: new Date('2026-10-18T00:00:00.000Z'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ days: 7, ...usage });
  });

  it('falls back to 30 days and refuses a missing or malformed user', async () => {
    const getUserUsageByContext = jest.fn().mockResolvedValue(usage);
    const handlers = createAdminBalanceHandlers(createDeps({ getUserUsageByContext }));

    const ok = mockRes();
    await handlers.userUsage(req({}, { userId: USER_ID, days: '365' }), ok);
    expect(ok.body).toMatchObject({ days: 30 });

    const missing = mockRes();
    await handlers.userUsage(req({}, {}), missing);
    expect(missing.statusCode).toBe(400);

    const bad = mockRes();
    await handlers.userUsage(req({}, { userId: 'nope' }), bad);
    expect(bad.statusCode).toBe(400);
  });
});

describe('createAdminBalanceHandlers effective access and bulk grants', () => {
  const OTHER_ID = '507f1f77bcf86cd799439012';

  it('adds what each access resolves to now, reading each role once', async () => {
    const getRoleAccess = jest.fn().mockResolvedValue({ local: false, private: true, api: false });
    const deps = createDeps({
      listUsersWithBalances: jest.fn().mockResolvedValue({
        total: 2,
        users: [
          {
            id: USER_ID,
            role: 'USER',
            packId: 'pro',
            modelAccess: {},
            mediaAccess: false,
            balance: { tokenCredits: 1, packId: 'pro' },
          },
          { id: OTHER_ID, role: 'USER', modelAccess: {}, balance: null },
        ],
      }),
      getAccessRules: jest.fn().mockResolvedValue({
        mediaPaidOnly: true,
        packs: [{ id: 'pro', label: 'Pro', credits: 1, grants: { api: true, local: true } }],
      }),
      getRoleAccess,
    });
    const res = mockRes();
    await createAdminBalanceHandlers(deps).listUsers(req(), res);
    const [first, second] = (res.body as { users: Array<{ effective: unknown }> }).users;
    expect(first.effective).toEqual({
      local: { allowed: true, source: 'pack' },
      private: { allowed: true, source: 'role' },
      api: { allowed: true, source: 'pack' },
      media: { allowed: false, source: 'user' },
      /** No pack includes the browser, so it stays off */
      browser: { allowed: false, source: 'rule' },
    });
    expect(second.effective).toMatchObject({
      local: { allowed: false, source: 'role' },
      media: { allowed: false, source: 'rule' },
    });
    expect(getRoleAccess).toHaveBeenCalledTimes(1);
  });

  it('leaves rows without effective access when the rules are not wired', async () => {
    const res = mockRes();
    await createAdminBalanceHandlers(createDeps()).listUsers(req(), res);
    expect((res.body as { users: Array<Record<string, unknown>> }).users[0]).not.toHaveProperty(
      'effective',
    );
  });

  it('grants one pack to several users and reports the ones that failed', async () => {
    const setUserPack = jest.fn().mockResolvedValue({});
    const deps = createDeps({
      setUserPack,
      findUserById: jest.fn(async (id: string) =>
        id === USER_ID ? { id: USER_ID, email: 'a@b.co' } : null,
      ),
    });
    const res = mockRes();
    await createAdminBalanceHandlers(deps).grantBulk(
      req({ userIds: [USER_ID, OTHER_ID, USER_ID], packId: 'starter' }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      granted: 1,
      failed: [OTHER_ID],
      credits: 2_000_000,
      pack: { id: 'starter', label: 'Starter' },
    });
    expect(deps.createTransaction).toHaveBeenCalledTimes(1);
    /** The pack is copied onto the user, so its grants travel on the loaded user */
    expect(setUserPack).toHaveBeenCalledWith(USER_ID, 'starter');
  });

  it('refuses a bulk grant without valid ids or with too many', async () => {
    const handlers = createAdminBalanceHandlers(createDeps());
    const none = mockRes();
    await handlers.grantBulk(req({ userIds: [], packId: 'starter' }), none);
    expect(none.statusCode).toBe(400);
    const bad = mockRes();
    await handlers.grantBulk(req({ userIds: ['nope'], packId: 'starter' }), bad);
    expect(bad.statusCode).toBe(400);
    const many = mockRes();
    await handlers.grantBulk(
      req({ userIds: Array.from({ length: 101 }, () => USER_ID), packId: 'starter' }),
      many,
    );
    expect(many.statusCode).toBe(400);
  });
});
