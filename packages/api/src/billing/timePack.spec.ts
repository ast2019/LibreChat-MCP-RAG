import type { TBalancePack } from 'librechat-data-provider';
import {
  grantTimePack,
  resolveTimePackGrant,
  grantedTimePackFromBalance,
  syncUserTimePackFromBalance,
  applyGrantedTimePackToUser,
} from './timePack';

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

const now = new Date('2026-01-10T00:00:00.000Z');
const granted = {
  timePackId: 'claude-time',
  timePackLabel: 'Claude month',
  timePackEndpoint: 'ClaudeTime',
  timePackExpiresAt: new Date('2026-03-02T00:00:00.000Z'),
  timePackGrantedAt: now,
  timePackRevision: 3,
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
    expect(setUserTimePack).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      pack: { id: 'claude-time', label: 'Claude month' },
      expiresAt: granted.timePackExpiresAt,
      endpoint: 'ClaudeTime',
      grantedAt: now,
    });
  });

  it('repairs the user copy with the same revision when the first copy returns false', async () => {
    const setUserTimePack = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await grantTimePack(
      {
        extendTimePack: jest.fn().mockResolvedValue(granted),
        setUserTimePack,
        now: () => now,
      },
      { userId: 'u1', pack: timePack, durationDays: 30, endpoint: 'ClaudeTime' },
    );

    expect(setUserTimePack).toHaveBeenNthCalledWith(1, 'u1', granted);
    expect(setUserTimePack).toHaveBeenNthCalledWith(2, 'u1', granted, {
      allowSameRevision: true,
    });
  });

  it('force-writes when both guarded copies fail and the user has no active entitlement', async () => {
    const setUserTimePack = jest
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const getUserTimePackFields = jest.fn().mockResolvedValue({});

    await grantTimePack(
      {
        extendTimePack: jest.fn().mockResolvedValue(granted),
        setUserTimePack,
        getUserTimePackFields,
        now: () => now,
      },
      { userId: 'u1', pack: timePack, durationDays: 30, endpoint: 'ClaudeTime' },
    );

    expect(setUserTimePack).toHaveBeenNthCalledWith(3, 'u1', granted, { force: true });
  });

  it('does not force-write when a newer grant already left an active entitlement on the user', async () => {
    const setUserTimePack = jest.fn().mockResolvedValue(false);
    const getUserTimePackFields = jest.fn().mockResolvedValue({
      timePackId: 'claude-time',
      timePackEndpoint: 'ClaudeTime',
      timePackExpiresAt: granted.timePackExpiresAt,
    });

    await grantTimePack(
      {
        extendTimePack: jest.fn().mockResolvedValue(granted),
        setUserTimePack,
        getUserTimePackFields,
        now: () => now,
      },
      { userId: 'u1', pack: timePack, durationDays: 30, endpoint: 'ClaudeTime' },
    );

    expect(setUserTimePack).toHaveBeenCalledTimes(2);
    expect(setUserTimePack).not.toHaveBeenCalledWith('u1', granted, { force: true });
  });

  it('throws when the balance wrote but the user copy cannot be forced', async () => {
    const setUserTimePack = jest.fn().mockResolvedValue(false);
    await expect(
      grantTimePack(
        {
          extendTimePack: jest.fn().mockResolvedValue(granted),
          setUserTimePack,
          getUserTimePackFields: jest.fn().mockResolvedValue({}),
          now: () => now,
        },
        { userId: 'u1', pack: timePack, durationDays: 30, endpoint: 'ClaudeTime' },
      ),
    ).rejects.toThrow(/could not copy onto the user/);
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

describe('grantedTimePackFromBalance', () => {
  it('returns fields for an active pack with a revision', () => {
    expect(
      grantedTimePackFromBalance(
        {
          timePackId: 'claude-time',
          timePackLabel: 'Claude month',
          timePackEndpoint: 'ClaudeTime',
          timePackExpiresAt: granted.timePackExpiresAt,
          timePackGrantedAt: now,
          timePackRevision: 2,
        },
        now,
      ),
    ).toEqual({
      timePackId: 'claude-time',
      timePackLabel: 'Claude month',
      timePackEndpoint: 'ClaudeTime',
      timePackExpiresAt: granted.timePackExpiresAt,
      timePackGrantedAt: now,
      timePackRevision: 2,
    });
  });

  it('synthesizes revision 1 for legacy active balance rows without a revision', () => {
    expect(
      grantedTimePackFromBalance(
        {
          timePackId: 'claude-time',
          timePackEndpoint: 'ClaudeTime',
          timePackExpiresAt: granted.timePackExpiresAt,
          timePackRevision: 0,
        },
        now,
      )?.timePackRevision,
    ).toBe(1);
    expect(
      grantedTimePackFromBalance(
        {
          timePackId: 'claude-time',
          timePackEndpoint: 'ClaudeTime',
          timePackExpiresAt: granted.timePackExpiresAt,
        },
        now,
      )?.timePackRevision,
    ).toBe(1);
  });

  it('returns null when the pack is expired', () => {
    expect(
      grantedTimePackFromBalance(
        {
          timePackId: 'claude-time',
          timePackEndpoint: 'ClaudeTime',
          timePackExpiresAt: new Date('2020-01-01T00:00:00.000Z'),
          timePackRevision: 1,
        },
        now,
      ),
    ).toBeNull();
  });
});

describe('syncUserTimePackFromBalance', () => {
  it('copies an active balance entitlement onto a user that lacks one', async () => {
    const setUserTimePack = jest.fn().mockResolvedValue(true);
    const findBalanceByUser = jest.fn().mockResolvedValue({
      timePackId: 'claude-time',
      timePackLabel: 'Claude month',
      timePackEndpoint: 'ClaudeTime',
      timePackExpiresAt: granted.timePackExpiresAt,
      timePackGrantedAt: now,
      timePackRevision: 4,
    });

    const result = await syncUserTimePackFromBalance(
      { findBalanceByUser, setUserTimePack, now: () => now },
      'u1',
      {},
    );

    expect(result?.timePackRevision).toBe(4);
    expect(setUserTimePack).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ timePackRevision: 4 }),
      { allowSameRevision: true },
    );
  });

  it('skips the balance read when the user already has an active entitlement', async () => {
    const findBalanceByUser = jest.fn();
    const setUserTimePack = jest.fn();
    const result = await syncUserTimePackFromBalance(
      { findBalanceByUser, setUserTimePack, now: () => now },
      'u1',
      {
        timePackId: 'claude-time',
        timePackEndpoint: 'ClaudeTime',
        timePackExpiresAt: granted.timePackExpiresAt,
      },
    );
    expect(result).toBeNull();
    expect(findBalanceByUser).not.toHaveBeenCalled();
    expect(setUserTimePack).not.toHaveBeenCalled();
  });

  it('returns null when the guarded copy refuses and the force write also refuses', async () => {
    const setUserTimePack = jest.fn().mockResolvedValue(false);
    const result = await syncUserTimePackFromBalance(
      {
        findBalanceByUser: jest.fn().mockResolvedValue({
          timePackId: 'claude-time',
          timePackEndpoint: 'ClaudeTime',
          timePackExpiresAt: granted.timePackExpiresAt,
          timePackRevision: 4,
        }),
        setUserTimePack,
        now: () => now,
      },
      'u1',
      {},
    );
    expect(result).toBeNull();
    expect(setUserTimePack).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ timePackRevision: 4 }),
      { force: true },
    );
  });

  it('force-writes when allowSameRevision refuses', async () => {
    const setUserTimePack = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const result = await syncUserTimePackFromBalance(
      {
        findBalanceByUser: jest.fn().mockResolvedValue({
          timePackId: 'claude-time',
          timePackEndpoint: 'ClaudeTime',
          timePackExpiresAt: granted.timePackExpiresAt,
          timePackRevision: 4,
        }),
        setUserTimePack,
        now: () => now,
      },
      'u1',
      {},
    );
    expect(result?.timePackId).toBe('claude-time');
    expect(setUserTimePack).toHaveBeenNthCalledWith(2, 'u1', expect.any(Object), { force: true });
  });

  it('applies granted fields onto a user object for routing', () => {
    const user: {
      id: string;
      timePackId?: string | null;
      timePackEndpoint?: string | null;
      timePackLabel?: string | null;
      timePackExpiresAt?: Date | string | null;
      timePackGrantedAt?: Date | string | null;
    } = { id: 'u1' };
    applyGrantedTimePackToUser(user, granted);
    expect(user.timePackId).toBe('claude-time');
    expect(user.timePackEndpoint).toBe('ClaudeTime');
  });
});
