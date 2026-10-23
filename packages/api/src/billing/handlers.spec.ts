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
    });
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
