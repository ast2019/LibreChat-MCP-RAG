jest.mock('@librechat/api', () => {
  const actual = jest.requireActual('@librechat/api');
  return {
    ...actual,
    resolveAppReleaseInfo: jest.fn(() => ({
      appVersion: '0.38.13',
      librechatVersion: 'v0.8.9-rc1',
    })),
    getBrowserStartupConfig: jest.fn(),
  };
});

jest.mock('~/server/services/Config', () => ({
  getAppConfig: jest.fn(),
}));

const mockDebugState = { enabled: false, level: 'warn' };
const mockSystemLines = [];
const mockProblemLines = [];
jest.mock('~/server/services/Debug', () => ({
  debugMode: { getState: jest.fn(async () => mockDebugState) },
  getSystemLog: () => ({ lines: mockSystemLines, dropped: 0 }),
  getProblemLog: () => ({ lines: mockProblemLines, dropped: 0 }),
}));

const { getBrowserStartupConfig } = require('@librechat/api');
const { getAppConfig } = require('~/server/services/Config');
const { buildDebugShareSnapshot } = require('./shareSnapshot');

describe('buildDebugShareSnapshot browser flag', () => {
  const previousFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    process.env.LIBRECHAT_CODE_BRIDGE_BASEURL = 'https://code.example/v1';
    getBrowserStartupConfig.mockReturnValue({ enabled: true });
    getAppConfig.mockResolvedValue({
      // YAML lives under config; a top-level browser key is only an admin override.
      config: { browser: { enabled: true, maxSessions: 10 } },
      endpoints: {
        agents: {
          statefulCodeSessions: {
            principalWorkers: { enabled: true, maxPerUser: 2 },
            environments: [
              { id: 'personal-workers', type: 'attached', baseURL: 'https://code.example/v1' },
            ],
          },
        },
      },
    });
  });

  afterEach(() => {
    global.fetch = previousFetch;
    delete process.env.LIBRECHAT_CODE_BRIDGE_BASEURL;
  });

  it('reports browser from getBrowserStartupConfig, not a missing top-level AppConfig.browser', async () => {
    const snapshot = await buildDebugShareSnapshot();

    expect(getBrowserStartupConfig).toHaveBeenCalled();
    expect(snapshot.browser).toEqual({ enabled: true, openSessions: null });
    // The Coolify false-negative: reading appConfig.browser directly would be false here.
    await expect(getAppConfig.mock.results[0].value).resolves.toMatchObject({
      config: { browser: { enabled: true } },
    });
    await expect(getAppConfig.mock.results[0].value).resolves.not.toHaveProperty('browser');
  });

  it('keeps browser disabled when the startup helper says the service is off', async () => {
    getBrowserStartupConfig.mockReturnValue({ enabled: false });

    const snapshot = await buildDebugShareSnapshot();

    expect(snapshot.browser).toEqual({ enabled: false, openSessions: null });
  });
});

describe('buildDebugShareSnapshot logs', () => {
  beforeEach(() => {
    getAppConfig.mockResolvedValue({});
    getBrowserStartupConfig.mockReturnValue({ enabled: false });
    mockProblemLines.length = 0;
  });

  it('includes recent warnings and errors with emails and IPs masked, and says debug mode is off', async () => {
    mockProblemLines.push({
      at: new Date().toISOString(),
      level: 'error',
      message: '[Login] [Login failed] [Username: a@b.com] [User ID: abc] [Request-IP: 10.0.4.17]',
    });

    const snapshot = await buildDebugShareSnapshot();

    expect(snapshot.logs.sources).toEqual(['problems']);
    expect(snapshot.logs.lines).toHaveLength(1);
    expect(snapshot.logs.lines[0].message).toContain('[User ID: abc]');
    expect(snapshot.logs.lines[0].message).toContain('10.0.x.x');
    expect(JSON.stringify(snapshot)).not.toContain('a@b.com');
    expect(snapshot.notes.join(' ')).toMatch(/Debug mode is off/);
  });
});

describe('buildDebugShareSnapshot remotion', () => {
  const previousFetch = global.fetch;
  const previousEnv = { ...process.env };

  beforeEach(() => {
    getAppConfig.mockResolvedValue({});
    getBrowserStartupConfig.mockReturnValue({ enabled: false });
    process.env.REMOTION_SERVICE_URL = 'http://remotion:3200';
    process.env.REMOTION_SERVICE_TOKEN = 'x'.repeat(40);
    global.fetch = jest.fn(async (url) => {
      const route = new URL(url).pathname;
      const body =
        route === '/logs'
          ? {
              ok: true,
              entries: [
                {
                  id: 1,
                  at: 't',
                  level: 'error',
                  event: 'render.fail',
                  data: { message: 'failed for a@b.com from 10.0.4.17' },
                },
              ],
            }
          : { ok: true, ready: true, bundle: 'ready', bundleDetail: { state: 'ready' } };
      return { status: 200, json: async () => body };
    });
  });

  afterEach(() => {
    global.fetch = previousFetch;
    process.env = { ...previousEnv };
  });

  it('adds a masked remotion section with health, status, workerLogs, clipEvents and hints', async () => {
    const snapshot = await buildDebugShareSnapshot();

    expect(snapshot.remotion).toMatchObject({
      configured: true,
      urlHost: 'remotion',
      health: { ok: true, ready: true },
    });
    expect(snapshot.remotion.status).toBeDefined();
    expect(snapshot.remotion.workerLogs).toHaveLength(1);
    expect(Array.isArray(snapshot.remotion.clipEvents)).toBe(true);
    expect(snapshot.remotion.hints.length).toBeGreaterThan(0);
    const text = JSON.stringify(snapshot.remotion);
    expect(text).not.toContain('a@b.com');
    expect(text).not.toContain('10.0.4.17');
    expect(text).not.toContain('x'.repeat(40));
    expect(snapshot.notes.join(' ')).toMatch(/remotion:/);
  });

  it('reports not configured when the env is missing', async () => {
    delete process.env.REMOTION_SERVICE_URL;
    const snapshot = await buildDebugShareSnapshot();
    expect(snapshot.remotion.configured).toBe(false);
    expect(snapshot.remotion.hints.join(' ')).toContain('REMOTION_SERVICE_URL');
  });
});
