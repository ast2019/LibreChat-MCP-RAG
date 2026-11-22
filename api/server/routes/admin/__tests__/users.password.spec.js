const mockSetPasswordDeps = {};
jest.mock('@librechat/api', () => {
  const handler = () => (_req, res) => res.sendStatus(204);
  const handlers = new Proxy({}, { get: () => handler() });
  return {
    GenerationJobManager: {},
    openCheckpointDeletion: jest.fn(),
    deleteAllSharedLinksWithCleanup: jest.fn(),
    createErasureResolver: jest.fn(() => jest.fn()),
    createAdminUsersHandlers: () => handlers,
    createAdminModelAccessHandlers: () => handlers,
    createAdminApiAccessHandlers: () => handlers,
    createAdminMediaAccessHandlers: () => handlers,
    createAdminBrowserAccessHandlers: () => handlers,
    createAdminAttachVmAccessHandlers: () => handlers,
    createAdminHiggsfieldAccessHandlers: () => handlers,
    createAdminBulkAccessHandler: () => handlers,
    createAdminSetPasswordHandler: (deps) => {
      Object.assign(mockSetPasswordDeps, deps);
      return handler();
    },
    hashSecret: jest.fn(),
    revokeUserCodeEnvironmentWorkers: jest.fn(),
  };
});

const mockHasCapability = jest.fn();
jest.mock('~/server/middleware/roles/capabilities', () => ({
  requireCapability: () => (_req, _res, next) => next(),
  hasCapability: (...args) => mockHasCapability(...args),
}));
jest.mock('~/server/middleware', () => ({ requireJwtAuth: (_req, _res, next) => next() }));
jest.mock('~/server/services/Agents/triggers', () => ({}));
jest.mock('~/server/services/Files/process', () => ({}));
jest.mock('~/server/services/Config/getCachedTools', () => ({}));
jest.mock('~/config', () => ({}));
jest.mock('~/server/services/MCP/oauthCleanup', () => ({}));
jest.mock('~/server/services/Endpoints/agents/subagentThreadStore', () => ({}));
jest.mock('~/server/services/Schedules', () => ({}));
jest.mock('~/server/services/Config', () => ({ getAppConfig: jest.fn() }));

const mockUpdateUser = jest.fn();
const mockDeleteAllUserSessions = jest.fn();
const mockAwaitEviction = jest.fn();
jest.mock('~/models', () => ({
  updateUser: (...args) => mockUpdateUser(...args),
  deleteAllUserSessions: (...args) => mockDeleteAllUserSessions(...args),
  awaitAuthUserDocEviction: (...args) => mockAwaitEviction(...args),
  findUser: jest.fn(),
}));

const { SystemCapabilities } = require('@librechat/data-schemas');
require('../users');

describe('admin set-password wiring', () => {
  it('saves the whole credential update, ends sessions and evicts the cached user', async () => {
    const update = { password: 'hash', credentialsChangedAt: new Date() };
    await mockSetPasswordDeps.savePassword('u1', update);
    expect(mockUpdateUser).toHaveBeenCalledWith('u1', update, {}, { preserveExpiresAt: true });

    await mockSetPasswordDeps.endSessions('u1');
    expect(mockDeleteAllUserSessions).toHaveBeenCalledWith({ userId: 'u1' });

    await mockSetPasswordDeps.awaitAuthUserDocEviction('u1');
    expect(mockAwaitEviction).toHaveBeenCalledWith('u1');
  });

  it('lets only role managers change an admin password', async () => {
    const req = { user: { id: 'admin1' } };
    mockHasCapability.mockResolvedValue(true);
    await mockSetPasswordDeps.canManageAdmins(req);
    expect(mockHasCapability).toHaveBeenCalledWith(req.user, SystemCapabilities.MANAGE_ROLES);
  });
});
