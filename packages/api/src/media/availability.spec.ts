import { getMediaAvailability } from './availability';

const appConfig = (higgsfieldShared = true) =>
  ({
    config: {
      mediaGeneration: { enabled: true, paidOnly: true, image: { model: 'google/image' } },
    },
    endpoints: {
      custom: [
        { name: 'OpenRouter', apiKey: 'sk', baseURL: 'https://openrouter.ai/api/v1', models: {} },
      ],
    },
    mcpConfig: {
      higgsfield: {
        url: 'https://mcp.higgsfield.ai/mcp',
        ...(higgsfieldShared ? { sharedOAuth: { ownerEmail: 'team@x.io', allow: 'paid' } } : {}),
      },
    },
  }) as never;

const deps = (over: Record<string, unknown> = {}) => ({
  findBalanceByUser: jest.fn().mockResolvedValue({ packId: 'starter' }),
  hasMcpConnection: jest.fn(async (userId: string) => userId === 'owner'),
  findUserIdByEmail: jest.fn().mockResolvedValue('owner'),
  ...over,
});

const state = (result: Awaited<ReturnType<typeof getMediaAvailability>>, id: string) =>
  result.ways.find((way) => way.id === id)?.state;

describe('media availability', () => {
  it('shows a paid user what is on, and the Higgsfield routes apart', async () => {
    const result = await getMediaAvailability(appConfig(), { id: 'u1' }, deps());
    expect(state(result, 'image')).toBe('active');
    expect(state(result, 'video')).toBe('not_configured');
    expect(state(result, 'higgsfield_api')).toBe('not_configured');
    expect(state(result, 'higgsfield_shared')).toBe('active');
    expect(state(result, 'higgsfield_own')).toBe('needs_connection');
    expect(result.higgsfieldServer).toBe('higgsfield');
  });

  it('tells a free-trial user a pack turns it on, and an admin switch wins', async () => {
    const free = deps({ findBalanceByUser: jest.fn().mockResolvedValue(null) });
    const result = await getMediaAvailability(appConfig(), { id: 'u1' }, free);
    expect(state(result, 'image')).toBe('needs_pack');
    expect(state(result, 'higgsfield_shared')).toBe('needs_pack');
    const off = await getMediaAvailability(appConfig(), { id: 'u1', mediaAccess: false }, deps());
    expect(state(off, 'image')).toBe('disabled_by_admin');
    expect(state(off, 'higgsfield_shared')).toBe('disabled_by_admin');
  });

  it('says when the shared owner has not connected, or nothing is shared', async () => {
    const notConnected = deps({ hasMcpConnection: jest.fn().mockResolvedValue(false) });
    const result = await getMediaAvailability(appConfig(), { id: 'u1' }, notConnected);
    expect(state(result, 'higgsfield_shared')).toBe('owner_not_connected');
    const unshared = await getMediaAvailability(appConfig(false), { id: 'u1' }, deps());
    expect(state(unshared, 'higgsfield_shared')).toBe('not_configured');
  });
});
