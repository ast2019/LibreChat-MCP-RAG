import { ErrorTypes, ViolationTypes } from 'librechat-data-provider';
import type { TBalanceConfig, TBalancePack } from 'librechat-data-provider';
import type { TimePackRequestLike } from './admitTimePack';
import type { TimeSeatEvictedLease } from './timeSeats';
import {
  releaseAdmittedRequestSlot,
  admitTimePackForRequest,
  admitTimePackRequest,
} from './admitTimePack';
import { resolveTimePackRoute, resolveTimePackTarget } from './route';
import { createTimeSeatPool } from './timeSeats';

const timePack: TBalancePack = {
  id: 'claude-time',
  label: 'Claude month',
  kind: 'time',
  durationDays: 30,
  endpoint: 'ClaudeTime',
};

const balance: Partial<TBalanceConfig> = {
  enabled: true,
  packs: [timePack],
  timePack: {
    maxSeats: 2,
    maxSeatsPerUser: 1,
    restMinutes: 60,
    usageWindowHours: 24,
    oversellMinMeteredCredits: 100,
    leaseSeconds: 60,
    redisFailure: 'memory',
  },
};

const entitled = (id: string) => ({
  id,
  timePackId: 'claude-time',
  timePackEndpoint: 'ClaudeTime',
  timePackExpiresAt: '2099-01-01T00:00:00.000Z',
});

const memoryPool = () => createTimeSeatPool({ redis: () => null });

describe('resolveTimePackRoute (F2)', () => {
  it('leaves endpoints that no time pack names alone', () => {
    expect(
      resolveTimePackRoute({ user: { id: 'u' }, endpoint: 'OpenRouter', packs: [timePack] }),
    ).toEqual({ kind: 'none' });
  });

  it('denies the time-pack endpoint without an active entitlement', () => {
    const expired = { ...entitled('u'), timePackExpiresAt: '2020-01-01T00:00:00.000Z' };
    for (const user of [{ id: 'u' }, expired, null]) {
      expect(
        resolveTimePackRoute({ user, endpoint: 'ClaudeTime', model: 'x', packs: [timePack] }),
      ).toEqual({ kind: 'denied', code: ErrorTypes.TIME_PACK_REQUIRED });
    }
  });

  it('denies a model outside the pack allowlist, including an unknown model (F3)', () => {
    const packs = [{ ...timePack, models: ['claude-sonnet-5-5'] }];
    const user = entitled('u');
    expect(
      resolveTimePackRoute({ user, endpoint: 'ClaudeTime', model: 'claude-sonnet-5-5', packs }),
    ).toMatchObject({ kind: 'seat' });
    expect(
      resolveTimePackRoute({ user, endpoint: 'ClaudeTime', model: 'claude-opus-5-5', packs }),
    ).toMatchObject({ kind: 'denied' });
    expect(
      resolveTimePackRoute({ user, endpoint: 'ClaudeTime', model: null, packs }),
    ).toMatchObject({ kind: 'denied' });
  });
});

describe('admitTimePackRequest', () => {
  it('does not log a violation for a second tab of an entitled user (F9)', async () => {
    const pool = memoryPool();
    const abortLease = jest.fn();
    await admitTimePackRequest({ userId: 'u', leaseId: 'tab-1', balance, abortLease, pool });

    const second = await admitTimePackRequest({
      userId: 'u',
      leaseId: 'tab-2',
      balance,
      abortLease,
      pool,
    });

    expect(second).toMatchObject({
      ok: false,
      reason: 'held',
      type: ViolationTypes.TIME_PACK_BUSY,
      logViolation: false,
      score: 0,
    });
  });

  it('still logs a violation when the pool is full', async () => {
    const pool = memoryPool();
    const abortLease = jest.fn();
    await admitTimePackRequest({ userId: 'a', leaseId: 'a1', balance, abortLease, pool });
    await admitTimePackRequest({ userId: 'b', leaseId: 'b1', balance, abortLease, pool });
    await expect(
      admitTimePackRequest({ userId: 'c', leaseId: 'c1', balance, abortLease, pool }),
    ).resolves.toMatchObject({ ok: false, reason: 'full', logViolation: true, score: 1 });
  });

  it('stops only the evicted generation, after the requester already holds the seat (F6)', async () => {
    const pool = memoryPool();
    const noop = jest.fn();
    await admitTimePackRequest({
      userId: 'heavy',
      leaseId: 'heavy-claude',
      balance,
      abortLease: noop,
      pool,
    });
    await admitTimePackRequest({
      userId: 'light',
      leaseId: 'light-claude',
      balance,
      abortLease: noop,
      pool,
    });
    await pool.addMeteredCredits('heavy', 500, balance.timePack);

    /** A third request arriving while the holder is being stopped must not take the seat. */
    let raced: Awaited<ReturnType<typeof admitTimePackRequest>> | undefined;
    const aborted: TimeSeatEvictedLease[] = [];
    const abortLease = jest.fn(async (lease: TimeSeatEvictedLease) => {
      aborted.push(lease);
      raced = await admitTimePackRequest({
        userId: 'third',
        leaseId: 'third-claude',
        balance,
        abortLease: noop,
        pool,
      });
    });

    const result = await admitTimePackRequest({
      userId: 'new',
      leaseId: 'new-claude',
      balance,
      abortLease,
      pool,
    });

    expect(result).toMatchObject({ ok: true });
    expect(aborted).toEqual([{ userId: 'heavy', leaseId: 'heavy-claude' }]);
    expect(raced).toMatchObject({ ok: false, reason: 'full' });
  });
});

describe('admitTimePackForRequest', () => {
  const request = (user: TimePackRequestLike['user'], extra: Partial<TimePackRequestLike> = {}) =>
    ({ user, config: { balance }, ...extra }) as TimePackRequestLike;

  it('denies a non-entitled user before acquiring anything, even for exempt runs (F2)', async () => {
    const pool = memoryPool();
    const acquire = jest.spyOn(pool, 'acquire');
    for (const extra of [{}, { _scheduleConcurrencyExempt: true }]) {
      const req = request({ id: 'free' }, extra);
      await expect(
        admitTimePackForRequest(req, {
          endpoint: 'ClaudeTime',
          model: 'claude-sonnet-5-5',
          leaseId: 's1',
          abortLease: jest.fn(),
          pool,
        }),
      ).resolves.toEqual({
        kind: 'denied',
        status: 403,
        body: { type: ErrorTypes.TIME_PACK_REQUIRED, code: ErrorTypes.TIME_PACK_REQUIRED },
      });
      expect(req._timePackSeatHeld).toBe(false);
      expect(req._timePackEntitlement).toBeNull();
    }
    expect(acquire).not.toHaveBeenCalled();
  });

  it('admits on the real endpoint of a saved agent and releases the lease (F1, F2)', async () => {
    const pool = memoryPool();
    const req = request(entitled('u'));
    const admission = await admitTimePackForRequest(req, {
      endpoint: 'ClaudeTime',
      model: 'claude-opus-5-5',
      leaseId: 'convo-1',
      abortLease: jest.fn(),
      pool,
    });

    expect(admission).toEqual({ kind: 'admitted' });
    expect(req._timePackSeatHeld).toBe(true);
    expect(req._timePackEntitlement).toMatchObject({ timePackEndpoint: 'ClaudeTime' });
    await expect(pool.listHolders()).resolves.toEqual(['u']);

    const decrementPendingRequest = jest.fn();
    await releaseAdmittedRequestSlot({ req, userId: 'u', decrementPendingRequest, pool });
    await expect(pool.listHolders()).resolves.toEqual([]);
    expect(decrementPendingRequest).not.toHaveBeenCalled();
    expect(req._timePackLease).toBeNull();
  });

  it('meters an exempt entitled run without taking a seat', async () => {
    const pool = memoryPool();
    const req = request(entitled('u'), { _scheduleConcurrencyExempt: true });
    await expect(
      admitTimePackForRequest(req, {
        endpoint: 'ClaudeTime',
        model: 'claude-opus-5-5',
        leaseId: 'convo-1',
        abortLease: jest.fn(),
        pool,
      }),
    ).resolves.toEqual({ kind: 'admitted' });
    expect(req._timePackSeatHeld).toBe(false);
    expect(req._timePackEntitlement).not.toBeNull();
    await expect(pool.listHolders()).resolves.toEqual([]);
  });

  it('returns none for other endpoints', async () => {
    const req = request(entitled('u'));
    await expect(
      admitTimePackForRequest(req, {
        endpoint: 'OpenRouter',
        model: 'x',
        leaseId: 'convo-1',
        abortLease: jest.fn(),
        pool: memoryPool(),
      }),
    ).resolves.toEqual({ kind: 'none' });
    expect(req._timePackEntitlement).toBeNull();
  });
});

describe('resolveTimePackTarget (F2)', () => {
  it("uses a saved agent's provider and model instead of the agents route", async () => {
    await expect(
      resolveTimePackTarget({
        endpointOption: {
          endpoint: 'agents',
          agent: Promise.resolve({ provider: 'ClaudeTime', model: 'claude-opus-5-5' }),
          model_parameters: {},
        },
      }),
    ).resolves.toEqual({ endpoint: 'ClaudeTime', model: 'claude-opus-5-5' });
  });

  it('falls back to the route fields when the agent load fails', async () => {
    await expect(
      resolveTimePackTarget({
        endpointOption: {
          endpoint: 'ClaudeTime',
          agent: Promise.reject(new Error('not found')),
          model_parameters: { model: 'claude-sonnet-5-5' },
        },
      }),
    ).resolves.toEqual({ endpoint: 'ClaudeTime', model: 'claude-sonnet-5-5' });
  });
});
