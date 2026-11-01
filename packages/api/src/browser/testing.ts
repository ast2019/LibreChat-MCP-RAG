/* Test doubles for the browser service, which runs in its own container. Not exported. */
import type { BrowserServiceClient, ServiceSession } from './client';
import type { BrowserLogStore } from './sessions';

export const TEST_USER_ID = '6650f0a1b2c3d4e5f6a7b8c9';

export const fakeSession = (overrides: Partial<ServiceSession> = {}): ServiceSession => ({
  id: 's1',
  owner: TEST_USER_ID,
  startedAt: 1_000,
  lastActiveAt: 1_000,
  idleMs: 180_000,
  maxMs: 1_200_000,
  domains: [],
  ...overrides,
});

export function fakeLog(open: string[] = []) {
  return {
    recordBrowserSessionStart: jest.fn(async () => undefined),
    recordBrowserSessionEnd: jest.fn(async () => true),
    recordBrowserRefusal: jest.fn(async () => undefined),
    listOpenBrowserSessionIds: jest.fn(async () => open),
  } satisfies BrowserLogStore;
}

export function fakeClient(overrides: Partial<BrowserServiceClient> = {}): BrowserServiceClient {
  return {
    status: jest.fn(async () => ({
      load: { at: 5, ram: null, cpu: null, container: null },
      history: [],
      sessions: [],
    })),
    events: jest.fn(async () => ({ events: [], last: 0 })),
    createSession: jest.fn(async () => fakeSession()),
    closeSession: jest.fn(async () => null),
    listSessions: jest.fn(async () => []),
    getSession: jest.fn(async () => null),
    open: jest.fn(async (_id: string, url: string) => ({ url, title: '' })),
    read: jest.fn(async () => ({ url: 'about:blank', title: '' })),
    act: jest.fn(async () => ({ url: 'about:blank', title: '' })),
    setControl: jest.fn(async () => fakeSession({ control: 'user' })),
    input: jest.fn(async () => ({ url: 'about:blank', title: '', focus: null })),
    frames: jest.fn(async () => new Response('')),
    ...overrides,
  };
}
