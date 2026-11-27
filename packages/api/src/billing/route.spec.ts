import {
  canonicalizeTimePackEntitlement,
  resolveCanonicalTimePackGateway,
  resolveTimePackRoute,
} from './route';

const future = new Date(Date.now() + 86_400_000);
const user = {
  id: 'u1',
  timePackId: 'claude-time',
  timePackEndpoint: 'ClaudeTime3D',
  timePackExpiresAt: future,
};

describe('resolveTimePackRoute with a stale user endpoint', () => {
  it('seats a holder whose pack id matches a row with a renamed gateway', () => {
    const route = resolveTimePackRoute({
      user,
      endpoint: 'ClaudeTime',
      model: 'claude-opus-5-5',
      packs: [{ id: 'claude-time', kind: 'time', endpoint: 'ClaudeTime' }],
    });
    expect(route.kind).toBe('seat');
  });

  it('seats a holder whose pack id no longer matches any time row', () => {
    const route = resolveTimePackRoute({
      user,
      endpoint: 'ClaudeTime',
      model: 'claude-opus-5-5',
      packs: [{ id: 'other', kind: 'time', endpoint: 'ClaudeTime' }],
    });
    expect(route.kind).toBe('seat');
  });

  it('still denies a user without an entitlement on the gateway', () => {
    const route = resolveTimePackRoute({
      user: { id: 'u2' },
      endpoint: 'ClaudeTime',
      packs: [{ id: 'claude-time', kind: 'time', endpoint: 'ClaudeTime' }],
    });
    expect(route.kind).toBe('denied');
  });
});

describe('canonical gateway across renames and several packs', () => {
  const specs = (...endpoints: string[]) => ({
    list: endpoints.map((endpoint, i) => ({
      name: `time-${i}`,
      timePack: true,
      preset: { endpoint, model: 'm' },
    })),
  });

  it('prefers the timePack spec endpoint over a pack row still named ClaudeTime3D', () => {
    const config = {
      balance: { packs: [{ id: 'claude-time', kind: 'time' as const, endpoint: 'ClaudeTime3D' }] },
      modelSpecs: specs('ClaudeTime'),
    };
    expect(resolveCanonicalTimePackGateway({ config, packId: 'claude-time' })).toBe('ClaudeTime');
    const route = resolveTimePackRoute({
      user,
      endpoint: 'ClaudeTime',
      model: 'm',
      config,
    });
    expect(route.kind).toBe('seat');
  });

  it('keeps each holder on the gateway of their own pack when several packs exist', () => {
    const config = {
      balance: {
        packs: [
          { id: 'a', kind: 'time' as const, endpoint: 'GatewayA' },
          { id: 'b', kind: 'time' as const, endpoint: 'GatewayB' },
        ],
      },
      modelSpecs: specs('GatewayA', 'GatewayB'),
    };
    expect(resolveCanonicalTimePackGateway({ config, packId: 'a' })).toBe('GatewayA');
    expect(resolveCanonicalTimePackGateway({ config, packId: 'b' })).toBe('GatewayB');
  });

  it('does not push a holder of a second pack onto the only spec gateway', () => {
    const config = {
      balance: {
        packs: [
          { id: 'a', kind: 'time' as const, endpoint: 'GatewayA' },
          { id: 'b', kind: 'time' as const, endpoint: 'GatewayB' },
        ],
      },
      modelSpecs: specs('GatewayA', 'GatewayB'),
    };
    const holderB = { ...user, timePackId: 'b', timePackEndpoint: 'GatewayB' };
    expect(
      resolveTimePackRoute({ user: holderB, endpoint: 'GatewayA', model: 'm', config }).kind,
    ).toBe('denied');
    expect(
      resolveTimePackRoute({ user: holderB, endpoint: 'GatewayB', model: 'm', config }).kind,
    ).toBe('seat');
  });

  it('canonicalizes a live entitlement for the BaseClient recovery path', () => {
    const config = {
      balance: { packs: [{ id: 'claude-time', kind: 'time' as const, endpoint: 'ClaudeTime3D' }] },
      modelSpecs: specs('ClaudeTime'),
    };
    const entitlement = {
      timePackId: 'claude-time',
      timePackEndpoint: 'ClaudeTime3D',
      timePackExpiresAt: future,
    };
    expect(canonicalizeTimePackEntitlement(entitlement, config)?.timePackEndpoint).toBe(
      'ClaudeTime',
    );
    expect(canonicalizeTimePackEntitlement(null, config)).toBeNull();
  });

  it('reports plan_mismatch, not no_entitlement, when an active plan does not cover the model', () => {
    const route = resolveTimePackRoute({
      user,
      endpoint: 'ClaudeTime',
      model: 'other-model',
      packs: [{ id: 'claude-time', kind: 'time', endpoint: 'ClaudeTime', models: ['m'] }],
    });
    expect(route).toMatchObject({ kind: 'denied', reason: 'plan_mismatch' });
  });
});
