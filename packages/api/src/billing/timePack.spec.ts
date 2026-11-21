import type { TBalancePack } from 'librechat-data-provider';
import { grantTimePack, resolveTimePackGrant } from './timePack';

const timePack: TBalancePack = {
  id: 'claude-time',
  label: 'Claude month',
  kind: 'time',
  durationDays: 30,
  endpoint: 'ClaudeTime',
};

const creditPack: TBalancePack = {
  id: 'starter',
  label: 'Starter',
  kind: 'credits',
  credits: 2_000_000,
};

describe('resolveTimePackGrant', () => {
  it('resolves a configured time pack', () => {
    expect(resolveTimePackGrant([timePack, creditPack], 'claude-time')).toEqual({
      ok: true,
      value: {
        pack: timePack,
        durationDays: 30,
        endpoint: 'ClaudeTime',
      },
    });
  });

  it('rejects credit packs and missing ids', () => {
    expect(resolveTimePackGrant([timePack, creditPack], 'starter').ok).toBe(false);
    expect(resolveTimePackGrant([timePack], 'missing').ok).toBe(false);
  });
});

describe('grantTimePack', () => {
  it('writes time fields without touching credits', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const upsertBalanceFields = jest.fn().mockResolvedValue({});
    const setUserTimePack = jest.fn().mockResolvedValue({});

    const result = await grantTimePack(
      { upsertBalanceFields, setUserTimePack, now: () => now },
      {
        userId: 'u1',
        pack: timePack,
        durationDays: 30,
        endpoint: 'ClaudeTime',
      },
    );

    expect(upsertBalanceFields).toHaveBeenCalledWith('u1', {
      timePackId: 'claude-time',
      timePackLabel: 'Claude month',
      timePackExpiresAt: new Date('2026-01-31T00:00:00.000Z'),
      timePackGrantedAt: now,
      timePackEndpoint: 'ClaudeTime',
    });
    expect(setUserTimePack).toHaveBeenCalled();
    expect(result.pack).toEqual({ id: 'claude-time', label: 'Claude month' });
  });
});
