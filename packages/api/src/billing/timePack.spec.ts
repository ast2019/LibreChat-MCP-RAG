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
  it('extends on the balance record and copies the result onto the user', async () => {
    const now = new Date('2026-01-10T00:00:00.000Z');
    const granted = {
      timePackId: 'claude-time',
      timePackLabel: 'Claude month',
      timePackEndpoint: 'ClaudeTime',
      timePackExpiresAt: new Date('2026-03-02T00:00:00.000Z'),
      timePackGrantedAt: now,
      timePackRevision: 3,
    };
    const extendTimePack = jest.fn().mockResolvedValue(granted);
    const setUserTimePack = jest.fn().mockResolvedValue(true);

    const result = await grantTimePack(
      { extendTimePack, setUserTimePack, now: () => now },
      { userId: 'u1', pack: timePack, durationDays: 30, endpoint: 'ClaudeTime' },
    );

    expect(extendTimePack).toHaveBeenCalledWith('u1', {
      timePackId: 'claude-time',
      timePackLabel: 'Claude month',
      timePackEndpoint: 'ClaudeTime',
      durationDays: 30,
      now,
    });
    expect(setUserTimePack).toHaveBeenCalledWith('u1', granted);
    expect(result).toEqual({
      pack: { id: 'claude-time', label: 'Claude month' },
      expiresAt: granted.timePackExpiresAt,
      endpoint: 'ClaudeTime',
      grantedAt: now,
    });
  });

  it('does not copy onto the user when the balance write fails', async () => {
    const setUserTimePack = jest.fn();
    await expect(
      grantTimePack(
        { extendTimePack: jest.fn().mockRejectedValue(new Error('db down')), setUserTimePack },
        { userId: 'u1', pack: timePack, durationDays: 30, endpoint: 'ClaudeTime' },
      ),
    ).rejects.toThrow('db down');
    expect(setUserTimePack).not.toHaveBeenCalled();
  });
});
