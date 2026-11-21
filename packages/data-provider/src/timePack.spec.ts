import {
  getActiveTimePackEntitlement,
  isTimePack,
  isTimePackClaudeRequest,
  timePackExpiresAt,
  TIME_METER_CONTEXT,
} from './timePack';

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
});
