import type { Response } from 'express';
import type { AdminBalanceDeps } from './handlers';
import type { RialRateRegistry } from './rial';
import {
  getAllotmentUsedPercent,
  createBalancePacksHandler,
  createAdminBalanceHandlers,
} from './handlers';

const USER_ID = '507f1f77bcf86cd799439011';

const RIAL_RATE = {
  marketRate: 2_695_000,
  feePercent: 20,
  rate: 3_234_000,
  source: 'tgju' as const,
  updatedAt: '2026-10-25T15:57:58.000Z',
  stale: false,
};

const rialRates = (
  result: Awaited<ReturnType<RialRateRegistry['getRate']>> = { ok: true, value: RIAL_RATE },
): RialRateRegistry => ({ getRate: jest.fn().mockResolvedValue(result) });

const RIAL_CONFIG = {
  enabled: true,
  source: 'tgju',
  feePercent: 20,
  refreshMinutes: 60,
  roundTo: 10_000,
};

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
  it('lists configured packs with USD and a null rial price when rial pricing is off', async () => {
    const res = mockRes();
    await createAdminBalanceHandlers(createDeps({ rialRates: rialRates() })).listPacks(req(), res);
    expect(res.body).toEqual({
      enabled: true,
      packs: [
        { id: 'starter', label: 'Starter', credits: 2_000_000, priceUsd: 2, priceRial: null },
      ],
      rial: null,
    });
  });

  it('prices packs in rial with the rate used', async () => {
    const res = mockRes();
    const registry = rialRates();
    const deps = createDeps({
      rialRates: registry,
      getBalanceConfig: jest.fn().mockResolvedValue({
        enabled: true,
        rial: RIAL_CONFIG,
        packs: [{ id: 'starter', label: 'Starter', credits: 2_000_000 }],
      }),
    });
    await createAdminBalanceHandlers(deps).listPacks(req(), res);
    expect(registry.getRate).toHaveBeenCalledWith(RIAL_CONFIG);
    expect(res.body).toEqual({
      enabled: true,
      packs: [
        { id: 'starter', label: 'Starter', credits: 2_000_000, priceUsd: 2, priceRial: 6_470_000 },
      ],
      rial: { enabled: true, ...RIAL_RATE },
    });
  });

  it('keeps listing packs without rial prices when no rate is available', async () => {
    const res = mockRes();
    const deps = createDeps({
      rialRates: rialRates({ ok: false, error: { code: 'rial_rate_unavailable' } }),
      getBalanceConfig: jest.fn().mockResolvedValue({
        enabled: true,
        rial: RIAL_CONFIG,
        packs: [{ id: 'starter', label: 'Starter', credits: 2_000_000 }],
      }),
    });
    await createAdminBalanceHandlers(deps).listPacks(req(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ packs: [{ priceUsd: 2, priceRial: null }], rial: null });
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
      rialPerUsd: null,
    });
  });

  it('reports the rial per USD rate (with fee) when rial pricing is on', async () => {
    const deps = createDeps({
      rialRates: rialRates(),
      getBalanceConfig: jest.fn().mockResolvedValue({ enabled: true, rial: RIAL_CONFIG }),
    });
    const res = mockRes();
    await createAdminBalanceHandlers(deps).summary(req({}, { days: '7' }), res);
    expect(res.body).toMatchObject({ rialPerUsd: 3_234_000 });
  });

  it('falls back to 30 days for an unsupported window', async () => {
    const res = mockRes();
    await createAdminBalanceHandlers(createDeps()).summary(req({}, { days: '365' }), res);
    expect(res.body).toMatchObject({ days: 30 });
  });
});

describe('createBalancePacksHandler', () => {
  const packs = [
    { id: 'starter', label: 'Starter', credits: 2_000_000, description: 'For a week' },
    { id: 'pro', label: 'Pro', credits: 10_000_000 },
  ];

  it('returns rial prices only, never USD or the rate', async () => {
    const res = mockRes();
    const handler = createBalancePacksHandler({
      rialRates: rialRates(),
      getBalanceConfig: jest.fn().mockResolvedValue({
        enabled: true,
        rial: RIAL_CONFIG,
        packs,
        purchaseUrl: 'https://shop.example.com',
      }),
    });
    await handler(req(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      enabled: true,
      packs: [
        { id: 'starter', label: 'Starter', description: 'For a week', priceRial: 6_470_000 },
        { id: 'pro', label: 'Pro', priceRial: 32_340_000 },
      ],
      purchaseUrl: 'https://shop.example.com',
    });
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/"(credits|priceUsd|rate|marketRate|feePercent|rial)"/);
    expect(text).not.toMatch(/\b(3234000|2695000)\b/);
  });

  it('lists packs with null prices when rial pricing is off or unavailable', async () => {
    const res = mockRes();
    const handler = createBalancePacksHandler({
      rialRates: rialRates({ ok: false, error: { code: 'rial_rate_unavailable' } }),
      getBalanceConfig: jest.fn().mockResolvedValue({ enabled: true, rial: RIAL_CONFIG, packs }),
    });
    await handler(req(), res);
    expect(res.body).toMatchObject({
      enabled: true,
      packs: [{ priceRial: null }, { priceRial: null }],
    });
    expect(res.body).not.toHaveProperty('purchaseUrl');
  });

  it('reports disabled with no packs while balance metering is off', async () => {
    const res = mockRes();
    const handler = createBalancePacksHandler({
      getBalanceConfig: jest.fn().mockResolvedValue({ enabled: false, packs }),
    });
    await handler(req(), res);
    expect(res.body).toEqual({ enabled: false, packs: [] });
  });

  it('hides internal failure details behind a generic 500', async () => {
    const res = mockRes();
    const handler = createBalancePacksHandler({
      getBalanceConfig: jest.fn().mockRejectedValue(new Error('config: secret detail')),
    });
    await handler(req(), res);
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret detail');
  });
});
