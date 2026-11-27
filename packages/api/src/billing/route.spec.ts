import { resolveTimePackRoute } from './route';

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
