import type { Request, Response } from 'express';
import { createCheckApiAccess, createRequireApiBalance } from './access';

function mockRes() {
  const res = {} as Response & { statusCode?: number; body?: { error?: { code?: string } } };
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  }) as unknown as Response['status'];
  res.json = jest.fn((body) => {
    res.body = body;
    return res;
  }) as unknown as Response['json'];
  return res;
}

const reqWith = (user: Record<string, unknown>, config: Record<string, unknown> = {}) =>
  ({ user, config }) as unknown as Request;

describe('createCheckApiAccess', () => {
  it('admits a user whose own switch is on without asking the role', () => {
    const role = jest.fn();
    const next = jest.fn();
    createCheckApiAccess(role)(reqWith({ id: 'u', apiAccess: true }), mockRes(), next);
    expect(next).toHaveBeenCalled();
    expect(role).not.toHaveBeenCalled();
  });

  it('refuses a user whose own switch is off even when the role allows', () => {
    const role = jest.fn((_req, _res, next) => next());
    const next = jest.fn();
    const res = mockRes();
    createCheckApiAccess(role)(reqWith({ id: 'u', apiAccess: false }), res, next);
    expect(res.statusCode).toBe(403);
    expect(res.body?.error?.code).toBe('api_access_disabled');
    expect(next).not.toHaveBeenCalled();
  });

  it('follows the role when the user has no switch', () => {
    const role = jest.fn();
    createCheckApiAccess(role)(reqWith({ id: 'u', apiAccess: null }), mockRes(), jest.fn());
    expect(role).toHaveBeenCalled();
  });
});

describe('createCheckApiAccess with pack grants', () => {
  const config = {
    balance: {
      packs: [
        { id: 'pro', label: 'Pro', credits: 1, grants: { api: true } },
        { id: 'basic', label: 'Basic', credits: 1, grants: { api: false } },
        { id: 'plain', label: 'Plain', credits: 1 },
      ],
    },
  };

  it('admits a user whose pack includes the API without asking the role', () => {
    const role = jest.fn();
    const next = jest.fn();
    createCheckApiAccess(role)(reqWith({ id: 'u', packId: 'pro' }, config), mockRes(), next);
    expect(next).toHaveBeenCalled();
    expect(role).not.toHaveBeenCalled();
  });

  it('refuses a user whose pack excludes the API, with its own code', () => {
    const role = jest.fn((_req, _res, next) => next());
    const res = mockRes();
    createCheckApiAccess(role)(reqWith({ id: 'u', packId: 'basic' }, config), res, jest.fn());
    expect(res.statusCode).toBe(403);
    expect(res.body?.error?.code).toBe('api_not_in_pack');
  });

  it('follows the role for a pack that does not say, and lets the user switch win', () => {
    const role = jest.fn();
    createCheckApiAccess(role)(reqWith({ id: 'u', packId: 'plain' }, config), mockRes(), jest.fn());
    expect(role).toHaveBeenCalledTimes(1);

    const next = jest.fn();
    createCheckApiAccess(role)(
      reqWith({ id: 'u', packId: 'basic', apiAccess: true }, config),
      mockRes(),
      next,
    );
    expect(next).toHaveBeenCalled();
  });
});

describe('createRequireApiBalance', () => {
  const enabled = { balance: { enabled: true } };

  it('refuses a call with no credit left', async () => {
    const res = mockRes();
    const next = jest.fn();
    await createRequireApiBalance({
      findBalanceByUser: jest.fn().mockResolvedValue({ tokenCredits: 0 }),
    })(reqWith({ id: 'u' }, enabled), res, next);
    expect(res.statusCode).toBe(402);
    expect(res.body?.error?.code).toBe('insufficient_balance');
    expect(next).not.toHaveBeenCalled();
  });

  it('lets a call with credit through, and skips the lookup when balance is off', async () => {
    const next = jest.fn();
    await createRequireApiBalance({
      findBalanceByUser: jest.fn().mockResolvedValue({ tokenCredits: 5 }),
    })(reqWith({ id: 'u' }, enabled), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    const lookup = jest.fn();
    await createRequireApiBalance({ findBalanceByUser: lookup })(
      reqWith({ id: 'u' }),
      mockRes(),
      next,
    );
    expect(lookup).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('answers a lookup failure as a server error, not as credit', async () => {
    const res = mockRes();
    const next = jest.fn();
    await createRequireApiBalance({
      findBalanceByUser: jest.fn().mockRejectedValue(new Error('db down')),
    })(reqWith({ id: 'u' }, enabled), res, next);
    expect(res.statusCode).toBe(500);
    expect(next).not.toHaveBeenCalled();
  });
});
