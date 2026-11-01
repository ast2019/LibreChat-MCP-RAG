import type { AppConfig } from '@librechat/data-schemas';
import type { EndedServiceSession } from './client';
import { getBrowserConfig, getBrowserService, resolveUserBrowserAccess } from './config';
import { BrowserServiceError, createBrowserServiceClient } from './client';
import { TEST_USER_ID, fakeClient, fakeLog, fakeSession } from './testing';
import { createBrowserAdminHandlers, describeServerLoad } from './admin';
import { createBrowserLogSync, openUserBrowser } from './sessions';

const USER_ID = TEST_USER_ID;
const session = fakeSession;

const appConfig = (browser: Record<string, unknown> = {}, packs: unknown[] = []) =>
  ({ browser, balance: { enabled: true, packs } }) as unknown as AppConfig;

describe('browser config', () => {
  it('fills the owner’s defaults: 10 browsers, 3 idle minutes, refuse at 85% RAM or 90% CPU', () => {
    expect(getBrowserConfig(undefined)).toEqual({
      enabled: true,
      maxSessions: 10,
      idleMinutes: 3,
      maxMinutes: 20,
      capacity: { ram: 85, cpu: 90 },
      logDays: 90,
      snapshotChars: 12_000,
      liveFps: 3,
      liveQuality: 50,
    });
    expect(getBrowserConfig(appConfig({ capacity: { ram: 70 } })).capacity).toEqual({
      ram: 70,
      cpu: 90,
    });
  });

  it('needs both the service URL and a long token', () => {
    const token = 'a'.repeat(64);
    expect(
      getBrowserService({
        BROWSER_SERVICE_URL: 'http://browser:3100/',
        BROWSER_SERVICE_TOKEN: token,
      }),
    ).toEqual({
      url: 'http://browser:3100',
      token,
    });
    expect(getBrowserService({ BROWSER_SERVICE_URL: 'http://browser:3100' })).toBeNull();
    expect(
      getBrowserService({
        BROWSER_SERVICE_URL: 'http://browser:3100',
        BROWSER_SERVICE_TOKEN: 'short',
      }),
    ).toBeNull();
  });

  it('lets admins in always, others through their override or pack, with the pack’s limit', () => {
    const packs = [
      { id: 'pro', label: 'Pro', credits: 10, grants: { browser: true }, browserSessions: 2 },
      { id: 'basic', label: 'Basic', credits: 1 },
    ];
    const config = appConfig({}, packs);
    expect(resolveUserBrowserAccess({ role: 'ADMIN', browserAccess: false }, config)).toEqual({
      allowed: true,
      source: 'admin',
      sessions: 1,
    });
    expect(resolveUserBrowserAccess({ role: 'USER', packId: 'pro' }, config)).toEqual({
      allowed: true,
      source: 'pack',
      sessions: 2,
    });
    expect(resolveUserBrowserAccess({ role: 'USER', packId: 'basic' }, config).allowed).toBe(false);
    expect(
      resolveUserBrowserAccess({ role: 'USER', packId: 'basic', browserAccess: true }, config),
    ).toMatchObject({ allowed: true, source: 'user', sessions: 1 });
  });
});

describe('openUserBrowser', () => {
  const user = { id: USER_ID, role: 'USER', packId: 'pro' };
  const config = appConfig({ maxSessions: 10, idleMinutes: 3 }, [
    { id: 'pro', label: 'Pro', credits: 10, grants: { browser: true } },
  ]);

  it('asks the service with the user’s and the server’s limits, and logs the start', async () => {
    const client = fakeClient();
    const log = fakeLog();
    const result = await openUserBrowser({ user, appConfig: config, client, log });
    expect(result).toEqual({ ok: true, session: session() });
    expect(client.createSession).toHaveBeenCalledWith({
      owner: USER_ID,
      ownerLimit: 1,
      serverLimit: 10,
      ram: 85,
      cpu: 90,
      idleMs: 180_000,
      maxMs: 1_200_000,
    });
    expect(log.recordBrowserSessionStart).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, sessionId: 's1', keepDays: 90 }),
    );
  });

  it('logs who was refused for a full server, with the cause', async () => {
    const client = fakeClient({
      createSession: jest.fn(async () => {
        throw new BrowserServiceError('capacity', 'above its ram limit', 503, 'ram');
      }),
    });
    const log = fakeLog();
    const result = await openUserBrowser({ user, appConfig: config, client, log });
    expect(result).toEqual({ ok: false, reason: 'capacity', detail: 'ram' });
    expect(log.recordBrowserRefusal).toHaveBeenCalledWith({
      userId: USER_ID,
      reason: 'capacity',
      detail: 'ram',
      keepDays: 90,
    });
  });

  it('refuses a user whose pack does not include it, without calling the service', async () => {
    const client = fakeClient();
    const log = fakeLog();
    const result = await openUserBrowser({
      user: { id: USER_ID, role: 'USER' },
      appConfig: config,
      client,
      log,
    });
    expect(result).toMatchObject({ ok: false, reason: 'not_allowed' });
    expect(client.createSession).not.toHaveBeenCalled();
  });

  it('reports a missing service as unavailable and logs it', async () => {
    const client = fakeClient({
      createSession: jest.fn(async () => {
        throw new BrowserServiceError('unavailable', 'did not answer');
      }),
    });
    const log = fakeLog();
    expect(await openUserBrowser({ user, appConfig: config, client, log })).toMatchObject({
      ok: false,
      reason: 'unavailable',
    });
    expect(log.recordBrowserRefusal).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'unavailable' }),
    );
    /* Off in the config, nothing is asked or logged. */
    const off = await openUserBrowser({
      user,
      appConfig: appConfig({ enabled: false }),
      client,
      log,
    });
    expect(off).toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('createBrowserLogSync', () => {
  const ended: EndedServiceSession = {
    ...session({ id: 's2', domains: ['www.digikala.com'] }),
    endedAt: 61_000,
    durationMs: 60_000,
    reason: 'idle',
  };

  it('writes the ends the service reports and marks browsers it no longer knows as lost', async () => {
    const log = fakeLog(['s1', 's2', 's3']);
    const client = fakeClient({
      status: jest.fn(async () => ({
        load: { at: 0, ram: null, cpu: null, container: null },
        history: [],
        sessions: [session({ id: 's1' })],
      })),
      events: jest.fn(async () => ({
        events: [{ seq: 1, at: 61_000, type: 'ended' as const, session: ended }],
        last: 1,
      })),
    });
    await createBrowserLogSync({ client, log }).syncOnce();
    expect(log.recordBrowserSessionEnd).toHaveBeenCalledWith({
      sessionId: 's2',
      reason: 'idle',
      endedAt: new Date(61_000),
      durationMs: 60_000,
      domains: ['www.digikala.com'],
    });
    expect(log.recordBrowserSessionEnd).toHaveBeenCalledWith({ sessionId: 's3', reason: 'lost' });
    expect(log.recordBrowserSessionEnd).not.toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 's1' }),
    );
  });

  it('starts over when the service restarted and counts from zero', async () => {
    const events = jest
      .fn()
      .mockResolvedValueOnce({ events: [], last: 5 })
      .mockResolvedValueOnce({ events: [], last: 2 })
      .mockResolvedValueOnce({ events: [], last: 2 });
    const sync = createBrowserLogSync({ client: fakeClient({ events }), log: fakeLog() });
    await sync.syncOnce();
    await sync.syncOnce();
    expect(events.mock.calls.map(([after]) => after)).toEqual([0, 5, 0]);
  });
});

describe('describeServerLoad', () => {
  const config = { capacity: { ram: 85, cpu: 90 }, maxSessions: 10 };
  const load = (ram: number, cpu: number, container: number | null = null) => ({
    ram: { percent: ram, used: 0, total: 0 },
    cpu,
    container: container == null ? null : { percent: container, used: 0, limit: 0 },
  });

  it('is full at a threshold or at the server-wide limit, and warns ten points before', () => {
    expect(describeServerLoad(load(40, 20), 0, config)).toEqual({
      state: 'normal',
      blocking: null,
    });
    expect(describeServerLoad(load(76, 20), 0, config)).toEqual({
      state: 'warning',
      blocking: null,
    });
    expect(describeServerLoad(load(40, 20), 8, config)).toEqual({
      state: 'warning',
      blocking: null,
    });
    expect(describeServerLoad(load(85, 20), 0, config)).toEqual({ state: 'full', blocking: 'ram' });
    expect(describeServerLoad(load(40, 20, 90), 0, config)).toEqual({
      state: 'full',
      blocking: 'ram',
    });
    expect(describeServerLoad(load(40, 95), 0, config)).toEqual({ state: 'full', blocking: 'cpu' });
    expect(describeServerLoad(load(40, 20), 10, config)).toEqual({
      state: 'full',
      blocking: 'server_full',
    });
  });
});

describe('createBrowserAdminHandlers', () => {
  const response = () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    return { res: { status, json } as never, status, json };
  };

  it('shows the load, the open browsers with their owners, and the history', async () => {
    const client = fakeClient({
      status: jest.fn(async () => ({
        load: { at: 9, ram: { percent: 50, used: 1, total: 2 }, cpu: 12, container: null },
        history: [{ at: 1, ram: 50, cpu: 12, container: null, sessions: 1 }],
        sessions: [session({ domains: ['divar.ir'] })],
      })),
    });
    const handlers = createBrowserAdminHandlers({
      getClient: () => client,
      log: { ...fakeLog(), listBrowserSessions: jest.fn() },
      findUsersByIds: jest.fn(async () => [{ _id: USER_ID, name: 'سارا', email: 's@example.com' }]),
    });
    const { res, json } = response();
    await handlers.getServerStatus({ config: appConfig() } as never, res);
    expect(json.mock.calls[0][0]).toMatchObject({
      enabled: true,
      reachable: true,
      state: 'normal',
      cpu: 12,
      sessions: [{ id: 's1', user: { id: USER_ID, name: 'سارا' }, domains: ['divar.ir'] }],
      history: [{ at: 1, ram: 50 }],
      limits: { ram: 85, cpu: 90, maxSessions: 10 },
    });
  });

  it('answers unreachable instead of failing when the service is down or not set up', async () => {
    const down = fakeClient({
      status: jest.fn(async () => {
        throw new BrowserServiceError('unavailable', 'down');
      }),
    });
    for (const getClient of [() => down, () => null]) {
      const handlers = createBrowserAdminHandlers({
        getClient,
        log: { ...fakeLog(), listBrowserSessions: jest.fn() },
        findUsersByIds: jest.fn(),
      });
      const { res, status, json } = response();
      await handlers.getServerStatus({ config: appConfig() } as never, res);
      expect(status).toHaveBeenCalledWith(200);
      expect(json.mock.calls[0][0]).toMatchObject({ reachable: false, sessions: [] });
    }
  });

  it('force-closes as admin and logs the end', async () => {
    const closeSession = jest.fn(async () => ({
      ...session(),
      endedAt: 2_000,
      durationMs: 1_000,
      reason: 'admin' as const,
    }));
    const log = { ...fakeLog(), listBrowserSessions: jest.fn() };
    const handlers = createBrowserAdminHandlers({
      getClient: () => fakeClient({ closeSession }),
      log,
      findUsersByIds: jest.fn(),
    });
    const { res, json } = response();
    await handlers.closeSession({ params: { id: 's1' } } as never, res);
    expect(closeSession).toHaveBeenCalledWith('s1', 'admin');
    expect(json).toHaveBeenCalledWith({ closed: true });
    expect(log.recordBrowserSessionEnd).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 's1', reason: 'admin' }),
    );
    const bad = response();
    await handlers.closeSession({ params: { id: '../x' } } as never, bad.res);
    expect(bad.status).toHaveBeenCalledWith(400);
  });

  it('lists the log with a known filter only, and dates as ISO strings', async () => {
    const listBrowserSessions = jest.fn(async () => ({
      total: 1,
      entries: [
        {
          id: 'l1',
          user: null,
          outcome: 'refused' as const,
          reason: 'capacity' as const,
          startedAt: new Date('2026-11-01T08:00:00Z'),
          endedAt: new Date('2026-11-01T08:00:00Z'),
          domains: [],
        },
      ],
    }));
    const handlers = createBrowserAdminHandlers({
      getClient: () => null,
      log: { ...fakeLog(), listBrowserSessions },
      findUsersByIds: jest.fn(),
    });
    const { res, json } = response();
    await handlers.listBrowserLog({ query: { filter: 'capacity', limit: '500' } } as never, res);
    expect(listBrowserSessions).toHaveBeenCalledWith({ filter: 'capacity', limit: 100, offset: 0 });
    expect(json.mock.calls[0][0].entries[0].startedAt).toBe('2026-11-01T08:00:00.000Z');
    await handlers.listBrowserLog({ query: { filter: '$where' } } as never, response().res);
    expect(listBrowserSessions).toHaveBeenLastCalledWith({ limit: 25, offset: 0 });
  });
});

describe('createBrowserServiceClient', () => {
  it('sends the token and turns refusals and silence into coded errors', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce({
        status: 503,
        json: async () => ({ error: 'server_full', message: 'full' }),
      })
      .mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const client = createBrowserServiceClient(
      { url: 'http://browser:3100', token: 't'.repeat(40) },
      fetchImpl as unknown as typeof fetch,
    );
    const input = {
      owner: USER_ID,
      ownerLimit: 1,
      serverLimit: 10,
      ram: 85,
      cpu: 90,
      idleMs: 1,
      maxMs: 2,
    };
    await expect(client.createSession(input)).rejects.toMatchObject({
      code: 'server_full',
      status: 503,
    });
    await expect(client.status()).rejects.toMatchObject({ code: 'unavailable' });
    expect(fetchImpl.mock.calls[0][0]).toBe('http://browser:3100/sessions');
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${'t'.repeat(40)}`);
  });
});
