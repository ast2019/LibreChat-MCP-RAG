import {
  getActiveTimePackEntitlement,
  resolveTimePackRuntime,
  isTimePackClaudeRequest,
  extendTimePackExpiry,
  timePackExpiresAt,
  TIME_METER_CONTEXT,
  isTimePackEndpoint,
  isTimePack,
} from './timePack';
import { DEFAULT_TIME_PACK_LEASE_SECONDS, timePackRuntimeSchema } from './config';

describe('timePack helpers', () => {
  it('exports the meter ledger context', () => {
    expect(TIME_METER_CONTEXT).toBe('time_meter');
  });

  it('detects time packs by kind', () => {
    expect(isTimePack({ kind: 'time' })).toBe(true);
    expect(isTimePack({ kind: 'credits' })).toBe(false);
    expect(isTimePack({})).toBe(false);
  });

  it('computes expiry from grant instant and durationDays', () => {
    const granted = new Date('2026-01-01T00:00:00.000Z');
    expect(timePackExpiresAt(granted, 30).toISOString()).toBe('2026-01-31T00:00:00.000Z');
  });

  it('returns active entitlement only before expiry', () => {
    const now = new Date('2026-01-15T00:00:00.000Z');
    expect(
      getActiveTimePackEntitlement(
        {
          timePackId: 'claude-time',
          timePackEndpoint: 'ClaudeTime',
          timePackExpiresAt: '2026-01-10T00:00:00.000Z',
        },
        now,
      ),
    ).toBeNull();
    expect(
      getActiveTimePackEntitlement(
        {
          timePackId: 'claude-time',
          timePackLabel: 'Claude month',
          timePackEndpoint: 'ClaudeTime',
          timePackExpiresAt: '2026-02-01T00:00:00.000Z',
        },
        now,
      ),
    ).toMatchObject({
      timePackId: 'claude-time',
      timePackEndpoint: 'ClaudeTime',
      timePackLabel: 'Claude month',
    });
  });

  it('matches Claude time-path requests by endpoint and optional model allowlist', () => {
    const entitlement = getActiveTimePackEntitlement({
      timePackId: 'claude-time',
      timePackEndpoint: 'ClaudeTime',
      timePackExpiresAt: '2099-01-01T00:00:00.000Z',
    });
    expect(
      isTimePackClaudeRequest({
        entitlement,
        endpoint: 'ClaudeTime',
        model: 'claude-sonnet-4-5',
      }),
    ).toBe(true);
    expect(
      isTimePackClaudeRequest({
        entitlement,
        endpoint: 'OpenRouter',
        model: 'claude-sonnet-4-5',
      }),
    ).toBe(false);
    expect(
      isTimePackClaudeRequest({
        entitlement,
        endpoint: 'ClaudeTime',
        model: 'claude-opus-4-5',
        models: ['claude-sonnet-4-5'],
      }),
    ).toBe(false);
  });

  it('recognizes the dedicated endpoints of time packs only', () => {
    const packs = [
      { kind: 'credits' as const, endpoint: 'OpenRouter' },
      { kind: 'time' as const, endpoint: 'ClaudeTime' },
    ];
    expect(isTimePackEndpoint(packs, 'ClaudeTime')).toBe(true);
    expect(isTimePackEndpoint(packs, 'OpenRouter')).toBe(false);
    expect(isTimePackEndpoint(undefined, 'ClaudeTime')).toBe(false);
    expect(isTimePackEndpoint(packs, null)).toBe(false);
  });

  it('does not match an empty model when the pack has a model allowlist', () => {
    const entitlement = getActiveTimePackEntitlement({
      timePackId: 'claude-time',
      timePackEndpoint: 'ClaudeTime',
      timePackExpiresAt: '2099-01-01T00:00:00.000Z',
    });
    for (const model of [undefined, null, '']) {
      expect(
        isTimePackClaudeRequest({
          entitlement,
          endpoint: 'ClaudeTime',
          model,
          models: ['claude-sonnet-5-5'],
        }),
      ).toBe(false);
    }
    expect(isTimePackClaudeRequest({ entitlement, endpoint: 'ClaudeTime', model: '' })).toBe(true);
  });

  it('extends a re-grant from the later of now and the current expiry', () => {
    const now = new Date('2026-01-10T00:00:00.000Z');
    expect(
      extendTimePackExpiry({
        currentExpiresAt: '2026-01-20T00:00:00.000Z',
        now,
        durationDays: 30,
      }).toISOString(),
    ).toBe('2026-02-19T00:00:00.000Z');
    expect(
      extendTimePackExpiry({
        currentExpiresAt: '2026-01-01T00:00:00.000Z',
        now,
        durationDays: 30,
      }).toISOString(),
    ).toBe('2026-02-09T00:00:00.000Z');
    expect(
      extendTimePackExpiry({ currentExpiresAt: null, now, durationDays: 1 }).toISOString(),
    ).toBe('2026-01-11T00:00:00.000Z');
  });

  it('resolves the seat lease and Redis failure levers with defaults', () => {
    expect(resolveTimePackRuntime(undefined)).toMatchObject({
      leaseSeconds: DEFAULT_TIME_PACK_LEASE_SECONDS,
      redisFailure: 'memory',
    });
    expect(timePackRuntimeSchema.parse({ redisFailure: 'reject', leaseSeconds: 60 })).toMatchObject(
      { redisFailure: 'reject', leaseSeconds: 60 },
    );
    expect(timePackRuntimeSchema.safeParse({ redisFailure: 'open' }).success).toBe(false);
    expect(timePackRuntimeSchema.safeParse({ leaseSeconds: 5 }).success).toBe(false);
  });
});
