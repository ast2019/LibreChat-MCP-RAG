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
        ...(higgsfieldShared ? { sharedOAuth: { ownerEmail: 'team@x.io' } } : {}),
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
  it('shows a granted user what is on, and the Higgsfield routes apart', async () => {
    const result = await getMediaAvailability(
      appConfig(),
      { id: 'u1', higgsfieldAccess: true },
      deps(),
    );
    expect(state(result, 'image')).toBe('active');
    expect(state(result, 'video')).toBe('not_configured');
    expect(state(result, 'higgsfield_api')).toBe('not_configured');
    expect(state(result, 'higgsfield_shared')).toBe('active');
    expect(state(result, 'higgsfield_own')).toBe('needs_connection');
    expect(result.higgsfieldServer).toBe('higgsfield');
  });

  it('tells a free-trial user a pack turns media on; only the switch shares Higgsfield', async () => {
    const free = deps({ findBalanceByUser: jest.fn().mockResolvedValue(null) });
    const result = await getMediaAvailability(appConfig(), { id: 'u1' }, free);
    expect(state(result, 'image')).toBe('needs_pack');
    expect(state(result, 'higgsfield_shared')).toBe('not_allowed');
    const paid = await getMediaAvailability(appConfig(), { id: 'u1', mediaAccess: true }, deps());
    expect(state(paid, 'higgsfield_shared')).toBe('not_allowed');
    const off = await getMediaAvailability(appConfig(), { id: 'u1', mediaAccess: false }, deps());
    expect(state(off, 'image')).toBe('disabled_by_admin');
    const admin = await getMediaAvailability(appConfig(), { id: 'u1', role: 'ADMIN' }, free);
    expect(state(admin, 'higgsfield_shared')).toBe('active');
  });

  it("uses the admin panel's owner over the config file's", async () => {
    const config = appConfig() as unknown as Record<string, Record<string, unknown>>;
    config.mediaGeneration = { higgsfieldSharedOwnerEmail: 'Boss@X.io' };
    const lookup = deps({ findUserIdByEmail: jest.fn().mockResolvedValue('owner') });
    await getMediaAvailability(config as never, { id: 'u1', higgsfieldAccess: true }, lookup);
    expect(lookup.findUserIdByEmail).toHaveBeenCalledWith('boss@x.io');
  });

  it('says when the shared owner has not connected, or nothing is shared', async () => {
    const notConnected = deps({ hasMcpConnection: jest.fn().mockResolvedValue(false) });
    const result = await getMediaAvailability(
      appConfig(),
      { id: 'u1', higgsfieldAccess: true },
      notConnected,
    );
    expect(state(result, 'higgsfield_shared')).toBe('owner_not_connected');
    const unshared = await getMediaAvailability(appConfig(false), { id: 'u1' }, deps());
    expect(state(unshared, 'higgsfield_shared')).toBe('not_configured');
  });
});
