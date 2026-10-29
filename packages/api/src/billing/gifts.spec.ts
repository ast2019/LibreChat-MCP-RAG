import type { Response } from 'express';
import { createAdminGiftHandlers, parseGiftUpdate, readGiftSettings } from './gifts';

function mockRes() {
  const res = {} as Response & { statusCode?: number; body?: Record<string, unknown> };
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

const fileConfig = {
  balance: { enabled: true, startBalance: 200_000 },
  config: { referral: { enabled: true, referrerCredits: 500_000, inviteeCredits: 200_000 } },
};

describe('gift settings', () => {
  it('reads the admin page values over the file', () => {
    const merged = {
      ...fileConfig,
      balance: { enabled: true, startBalance: 1_000_000 },
      referral: { referrerCredits: 750_000 },
    };
    expect(readGiftSettings(merged as never)).toEqual({
      startBalance: 1_000_000,
      referral: {
        enabled: true,
        referrerCredits: 750_000,
        inviteeCredits: 200_000,
        maxRewardsPerReferrer: 20,
      },
    });
  });

  it('accepts only whole, bounded amounts', () => {
    expect(parseGiftUpdate({ startBalance: 300_000, referral: { inviteeCredits: 0 } })).toEqual({
      ok: true,
      fields: { 'balance.startBalance': 300_000, 'referral.inviteeCredits': 0 },
    });
    expect(parseGiftUpdate({ startBalance: -1 })).toEqual({
      ok: false,
      code: 'invalid_start_balance',
    });
    expect(parseGiftUpdate({ referral: { referrerCredits: 1.5 } })).toMatchObject({ ok: false });
    expect(parseGiftUpdate({})).toEqual({ ok: false, code: 'nothing_to_change' });
  });

  it('stores the change as a base override, drops caches, and returns the new values', async () => {
    const patchBaseFields = jest.fn().mockResolvedValue(undefined);
    const invalidate = jest.fn();
    const handlers = createAdminGiftHandlers({
      getAppConfig: jest.fn().mockResolvedValue(fileConfig),
      getBaseChangedAt: jest.fn().mockResolvedValue(new Date('2026-10-29T10:00:00Z')),
      patchBaseFields,
      invalidate,
    });
    const res = mockRes();
    await handlers.updateGifts(
      {
        body: { referral: { referrerCredits: 600_000 } },
        user: { id: 'a', tenantId: 't' },
      } as never,
      res,
    );
    expect(patchBaseFields).toHaveBeenCalledWith({ 'referral.referrerCredits': 600_000 });
    expect(invalidate).toHaveBeenCalledWith('t');
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ changedAt: '2026-10-29T10:00:00.000Z' });
  });
});
