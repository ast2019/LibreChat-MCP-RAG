import { ErrorTypes, ViolationTypes } from 'librechat-data-provider';
import type { TBalanceConfig, TBalancePack } from 'librechat-data-provider';
import type { TimePackRequestLike } from './admitTimePack';
import type { TimeSeatEvictedLease } from './timeSeats';
import {
  releaseAdmittedRequestSlot,
  admitAgentTimePack,
  admitTimePackForRequest,
  admitTimePackRequest,
} from './admitTimePack';
import {
  isConfiguredTimePackEndpoint,
  resolveTimePackRoute,
  resolveTimePackTarget,
} from './route';
import { createTimePackRatePool } from './timeRate';
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
    requestsPerMinute: 60,
    userSharePerMinute: 20,
    rateWaitMs: 15_000,
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

  it('returns the rate slot when the seat pool refuses, so seat contention does not starve the minute', async () => {
    const pool = memoryPool();
    const ratePool = createTimePackRatePool({ redis: () => null });
    const noop = jest.fn();
    await admitTimePackRequest({
      userId: 'a',
      leaseId: 'a1',
      balance,
      abortLease: noop,
      pool,
    });
    await admitTimePackRequest({
      userId: 'b',
      leaseId: 'b1',
      balance,
      abortLease: noop,
      pool,
    });

    const req = request(entitled('c'));
    await expect(
      admitTimePackForRequest(req, {
        endpoint: 'ClaudeTime',
        model: 'claude-opus-5-5',
        leaseId: 'c1',
        abortLease: noop,
        pool,
        ratePool,
      }),
    ).resolves.toMatchObject({ kind: 'rejected', admission: { reason: 'full' } });

    expect(await ratePool.read('c')).toEqual({ globalCount: 0, userCount: 0 });
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

  it('prefers agent.endpoint after initialize swaps provider to the SDK name', async () => {
    await expect(
      resolveTimePackTarget({
        endpointOption: {
          endpoint: 'agents',
          agent: Promise.resolve({
            endpoint: 'ClaudeTime',
            provider: 'anthropic',
            model: 'claude-fable-5-1',
          }),
        },
      }),
    ).resolves.toEqual({ endpoint: 'ClaudeTime', model: 'claude-fable-5-1' });
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

  it('uses a timePack modelSpec when the agents route would otherwise miss ClaudeTime', async () => {
    await expect(
      resolveTimePackTarget({
        endpointOption: {
          endpoint: 'agents',
          spec: 'time-smart',
          agent: Promise.resolve({ provider: 'agents', model: 'claude-sonnet-5-5' }),
          model_parameters: { model: 'claude-sonnet-5-5' },
        },
        config: {
          modelSpecs: {
            list: [
              {
                name: 'time-smart',
                timePack: true,
                preset: { endpoint: 'ClaudeTime', model: 'claude-sonnet-5-5' },
              },
            ],
          },
        },
      }),
    ).resolves.toEqual({ endpoint: 'ClaudeTime', model: 'claude-sonnet-5-5' });
  });
});

describe('isConfiguredTimePackEndpoint', () => {
  it('names pack endpoints and timePack model specs', () => {
    const config = {
      balance: { packs: [timePack] },
      modelSpecs: { list: [{ timePack: true, preset: { endpoint: 'ClaudeTime' } }] },
    };
    expect(isConfiguredTimePackEndpoint('ClaudeTime', config)).toBe(true);
    expect(isConfiguredTimePackEndpoint('OpenRouter', config)).toBe(false);
  });
});

describe('admitAgentTimePack when packs lost kind:time', () => {
  /** Production still has `timePack` modelSpecs even if an admin override emptied `kind:time` packs. */
  const request = (user: TimePackRequestLike['user']) =>
    ({
      user,
      config: {
        balance: { ...balance, packs: [] },
        modelSpecs: {
          list: [{ timePack: true, preset: { endpoint: 'ClaudeTime', model: 'claude-opus-5-5' } }],
        },
      },
    }) as TimePackRequestLike;

  it('denies ClaudeTime without an entitlement instead of returning none', async () => {
    const req = request({ id: 'free' });
    await expect(
      admitAgentTimePack(req, {
        endpointOption: {
          endpoint: 'ClaudeTime',
          model_parameters: { model: 'claude-opus-5-5' },
        },
        body: {},
        leaseId: 's1',
        abortLease: jest.fn(),
        pool: memoryPool(),
      }),
    ).resolves.toMatchObject({
      kind: 'denied',
      body: { code: ErrorTypes.TIME_PACK_REQUIRED },
    });
    expect(req._timePackSeatHeld).toBe(false);
  });

  it('still seats when the user entitlement survived the pack-list override', async () => {
    const req = request(entitled('u'));
    await expect(
      admitAgentTimePack(req, {
        endpointOption: {
          endpoint: 'agents',
          agent: Promise.resolve({
            endpoint: 'ClaudeTime',
            provider: 'anthropic',
            model: 'claude-opus-5-5',
          }),
        },
        body: {},
        leaseId: 's1',
        abortLease: jest.fn(),
        pool: memoryPool(),
      }),
    ).resolves.toEqual({ kind: 'admitted' });
    expect(req._timePackEntitlement).not.toBeNull();
    expect(req._timePackSeatHeld).toBe(true);
  });
});

describe('admitAgentTimePack product scenario (menu + gateway)', () => {
  const timePackConfig = {
    balance,
    modelSpecs: {
      list: [
        {
          name: 'time-smart',
          timePack: true,
          group: 'ClaudeTime',
          preset: { endpoint: 'ClaudeTime', model: 'claude-sonnet-5-5' },
        },
        {
          name: 'smart',
          group: 'Claude',
          preset: { endpoint: 'OpenRouter', model: '~anthropic/claude-sonnet-latest' },
        },
      ],
    },
  };

  it('holder + timePack spec on agents route → seats ClaudeTime (not credits)', async () => {
    const req = {
      user: entitled('holder'),
      config: timePackConfig,
    } as TimePackRequestLike;
    await expect(
      admitAgentTimePack(req, {
        endpointOption: {
          endpoint: 'agents',
          spec: 'time-smart',
          agent: Promise.resolve({ provider: 'agents', model: 'claude-sonnet-5-5' }),
          model_parameters: { model: 'claude-sonnet-5-5' },
        },
        body: { spec: 'time-smart', endpoint: 'agents' },
        leaseId: 's-holder',
        abortLease: jest.fn(),
        pool: memoryPool(),
      }),
    ).resolves.toEqual({ kind: 'admitted' });
    expect(req._timePackEntitlement).toMatchObject({ timePackEndpoint: 'ClaudeTime' });
    expect(req._timePackSeatHeld).toBe(true);
  });

  it('no pack + timePack spec → time_pack_required (never none/credits)', async () => {
    const req = {
      user: { id: 'free' },
      config: timePackConfig,
    } as TimePackRequestLike;
    await expect(
      admitAgentTimePack(req, {
        endpointOption: {
          endpoint: 'agents',
          spec: 'time-smart',
          agent: Promise.resolve({ provider: 'agents', model: 'claude-sonnet-5-5' }),
          model_parameters: { model: 'claude-sonnet-5-5' },
        },
        body: { spec: 'time-smart', endpoint: 'agents' },
        leaseId: 's-free',
        abortLease: jest.fn(),
        pool: memoryPool(),
      }),
    ).resolves.toMatchObject({
      kind: 'denied',
      body: { code: ErrorTypes.TIME_PACK_REQUIRED },
    });
    expect(req._timePackEntitlement).toBeNull();
  });

  it('OpenRouter Claude credit path stays none (Balance.check), even with a pack', async () => {
    const req = {
      user: entitled('holder'),
      config: timePackConfig,
    } as TimePackRequestLike;
    const ratePool = createTimePackRatePool({ redis: () => null });
    const acquire = jest.spyOn(ratePool, 'acquire');
    await expect(
      admitAgentTimePack(req, {
        endpointOption: {
          endpoint: 'OpenRouter',
          spec: 'smart',
          agent: Promise.resolve({
            provider: 'OpenRouter',
            model: '~anthropic/claude-sonnet-latest',
          }),
          model_parameters: { model: '~anthropic/claude-sonnet-latest' },
        },
        body: { spec: 'smart', endpoint: 'OpenRouter' },
        leaseId: 's-credit',
        abortLease: jest.fn(),
        pool: memoryPool(),
        ratePool,
      }),
    ).resolves.toEqual({ kind: 'none' });
    expect(req._timePackEntitlement).toBeNull();
    expect(req._timePackSeatHeld).toBe(false);
    expect(acquire).not.toHaveBeenCalled();
  });
});

describe('resolveTimePackRoute when packs lost kind:time', () => {
  it('still seats an entitled user on their entitlement endpoint', () => {
    const user = entitled('u');
    expect(
      resolveTimePackRoute({
        user,
        endpoint: 'ClaudeTime',
        model: 'claude-fable-5-1',
        packs: [{ id: 'claude-time', kind: 'credits', endpoint: 'ClaudeTime' }],
      }),
    ).toMatchObject({ kind: 'seat', entitlement: { timePackId: 'claude-time' } });
  });

  it('leaves unrelated endpoints alone without a kind:time pack', () => {
    expect(
      resolveTimePackRoute({
        user: entitled('u'),
        endpoint: 'OpenRouter',
        model: 'x',
        packs: [{ id: 'starter', kind: 'credits', credits: 100 }],
      }),
    ).toEqual({ kind: 'none' });
  });
});
