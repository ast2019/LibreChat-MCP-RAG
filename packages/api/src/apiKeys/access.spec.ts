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
