import { getHiggsfieldStatus, resolveHiggsfieldSharedOwner } from './higgsfieldShared';
import { probeHiggsfield } from '~/status/fetchers';
import { createAdminHiggsfieldHandlers } from '~/admin/higgsfield';

const mcpConfig = (shared = true) => ({
  higgsfield: {
    url: 'https://mcp.higgsfield.ai/mcp',
    ...(shared ? { sharedOAuth: { ownerEmail: 'env@x.io' } } : {}),
  },
});

const appConfig = (over: Record<string, unknown> = {}) =>
  ({
    config: {
      mediaGeneration: {
        enabled: true,
        higgsfield: { apiKeyId: '${HF_TEST_ID}', apiKeySecret: '${HF_TEST_SECRET}' },
      },
    },
    mcpConfig: mcpConfig(),
    ...over,
  }) as never;

const deps = (over: Record<string, unknown> = {}) => ({
  findUserIdByEmail: jest.fn().mockResolvedValue('owner'),
  hasMcpConnection: jest.fn().mockResolvedValue(true),
  ...over,
});

afterEach(() => {
  delete process.env.HF_TEST_ID;
  delete process.env.HF_TEST_SECRET;
});

describe('Higgsfield shared owner', () => {
  it("prefers the admin panel's email and falls back to the config file", () => {
    const entry = mcpConfig().higgsfield;
    expect(resolveHiggsfieldSharedOwner(appConfig(), entry)).toEqual({
      email: 'env@x.io',
      source: 'env',
    });
    const chosen = appConfig({ mediaGeneration: { higgsfieldSharedOwnerEmail: 'Admin@X.io' } });
    expect(resolveHiggsfieldSharedOwner(chosen, entry)).toEqual({
      email: 'admin@x.io',
      source: 'admin',
    });
    expect(resolveHiggsfieldSharedOwner(chosen, { url: 'x' } as never)).toEqual({});
  });
});

describe('Higgsfield status', () => {
  it('reports missing API keys and a connected shared owner', async () => {
    const status = await getHiggsfieldStatus(appConfig(), deps());
    expect(status).toMatchObject({
      mcpServer: 'higgsfield',
      apiDeclared: true,
      apiKeysSet: false,
      sharingEnabled: true,
      owner: { email: 'env@x.io', source: 'env', found: true, connected: true },
    });
    process.env.HF_TEST_ID = 'id';
    process.env.HF_TEST_SECRET = 'secret';
    expect((await getHiggsfieldStatus(appConfig(), deps())).apiKeysSet).toBe(true);
  });

  it('turns into service status lines for the admin', async () => {
    const missing = await probeHiggsfield(async () =>
      getHiggsfieldStatus(
        appConfig(),
        deps({ hasMcpConnection: jest.fn().mockResolvedValue(false) }),
      ),
    );
    expect(missing).toMatchObject({ configured: true, errorCode: 'api_keys_missing' });
    expect(missing.details).toEqual([
      { name: 'api_keys', healthy: false, errorCode: 'api_keys_missing' },
      { name: 'shared_account', healthy: false, errorCode: 'owner_not_connected' },
    ]);
    const none = await probeHiggsfield(async () =>
      getHiggsfieldStatus({ config: {}, mcpConfig: {} } as never, deps()),
    );
    expect(none.configured).toBe(false);
  });
});

describe('admin Higgsfield handlers', () => {
  const response = () => {
    const res = { status: jest.fn(), json: jest.fn() };
    res.status.mockReturnValue(res);
    return res;
  };
  const handlers = (over: Record<string, unknown> = {}) => {
    const all = {
      ...deps(),
      getAppConfig: jest.fn().mockResolvedValue(appConfig()),
      patchBaseFields: jest.fn(),
      unsetBaseFields: jest.fn(),
      invalidate: jest.fn(),
      ...over,
    };
    return { all, ...createAdminHiggsfieldHandlers(all as never) };
  };

  it('stores an existing user as the owner, lowercased', async () => {
    const { all, updateHiggsfield } = handlers();
    const res = response();
    await updateHiggsfield(
      { body: { ownerEmail: ' Boss@X.io ' }, user: {} } as never,
      res as never,
    );
    expect(all.patchBaseFields).toHaveBeenCalledWith({
      'mediaGeneration.higgsfieldSharedOwnerEmail': 'boss@x.io',
    });
    expect(all.invalidate).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('refuses an unknown user or a bad email, and clears with null', async () => {
    const unknown = handlers({ findUserIdByEmail: jest.fn().mockResolvedValue(null) });
    const res = response();
    await unknown.updateHiggsfield({ body: { ownerEmail: 'a@b.io' } } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'owner_not_found' } });

    const bad = response();
    await unknown.updateHiggsfield({ body: { ownerEmail: 'nope' } } as never, bad as never);
    expect(bad.json).toHaveBeenCalledWith({ error: { code: 'invalid_owner_email' } });

    const { all, updateHiggsfield } = handlers();
    await updateHiggsfield({ body: { ownerEmail: null } } as never, response() as never);
    expect(all.unsetBaseFields).toHaveBeenCalledWith([
      'mediaGeneration.higgsfieldSharedOwnerEmail',
    ]);
    expect(all.patchBaseFields).not.toHaveBeenCalled();
  });
});
