const express = require('express');
const request = require('supertest');

let mockUser = { id: 'admin-1', role: 'ADMIN' };
const mockRequireJwtAuth = jest.fn((req, res, next) => {
  if (!mockUser) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  req.user = mockUser;
  next();
});
/** Grants the admin capabilities to admins only, as the capability store does by default. */
const mockAdminCapabilities = ['access:admin', 'read:users', 'manage:users'];
const mockRequireCapability = jest.fn(
  (capability) => (req, res, next) =>
    mockAdminCapabilities.includes(capability) && req.user?.role === 'ADMIN'
      ? next()
      : res.status(403).json({ message: 'Forbidden' }),
);
const mockService = {
  get: jest.fn(async () => ({ services: [], chain: [] })),
  refresh: jest.fn(async () => ({ services: [{ id: 'serper' }], chain: [] })),
};

jest.mock('@librechat/data-schemas', () => ({
  SystemCapabilities: {
    ACCESS_ADMIN: 'access:admin',
    READ_USERS: 'read:users',
    MANAGE_USERS: 'manage:users',
  },
  BASE_CONFIG_PRINCIPAL_ID: '__base__',
}));
jest.mock('@librechat/api', () => {
  const { createAdminStatusHandlers, createAdminHiggsfieldHandlers } =
    jest.requireActual('@librechat/api');
  return { createAdminStatusHandlers, createAdminHiggsfieldHandlers };
});
jest.mock('~/server/services/Config', () => ({
  getAppConfig: jest.fn(async () => ({ config: {}, mcpConfig: {} })),
  invalidateConfigCaches: jest.fn(),
}));
jest.mock('~/models', () => ({
  patchConfigFields: jest.fn(),
  unsetConfigField: jest.fn(),
}));
jest.mock('~/server/middleware/roles/capabilities', () => ({
  requireCapability: mockRequireCapability,
}));
jest.mock('~/server/middleware', () => ({ requireJwtAuth: mockRequireJwtAuth }));
jest.mock('~/server/services/ServiceStatus', () => ({
  getServiceStatus: () => mockService,
  higgsfieldStatusDeps: {
    findUserIdByEmail: jest.fn(async () => null),
    hasMcpConnection: jest.fn(async () => false),
  },
}));

function createApp() {
  const router = require('./status');
  const app = express();
  app.use(express.json());
  app.use('/api/admin/status', router);
  return app;
}

describe('admin service status routes', () => {
  beforeEach(() => {
    mockUser = { id: 'admin-1', role: 'ADMIN' };
    jest.clearAllMocks();
  });

  it('serves the status to an admin', async () => {
    const response = await request(createApp()).get('/api/admin/status').expect(200);

    expect(response.body).toEqual({ services: [], chain: [] });
    expect(mockRequireCapability).toHaveBeenCalledWith('access:admin');
  });

  it('refreshes on POST /refresh', async () => {
    const response = await request(createApp()).post('/api/admin/status/refresh').expect(200);

    expect(response.body.services).toEqual([{ id: 'serper' }]);
    expect(mockService.refresh).toHaveBeenCalledTimes(1);
  });

  it('refuses a signed-in user without admin access before loading anything', async () => {
    mockUser = { id: 'user-1', role: 'USER' };
    await request(createApp()).get('/api/admin/status').expect(403);
    await request(createApp()).post('/api/admin/status/refresh').expect(403);

    expect(mockService.get).not.toHaveBeenCalled();
    expect(mockService.refresh).not.toHaveBeenCalled();
  });

  it('serves the Higgsfield setup and refuses an unknown owner', async () => {
    const response = await request(createApp()).get('/api/admin/status/higgsfield').expect(200);
    expect(response.body).toMatchObject({ mcpServer: null, apiDeclared: false });

    const refused = await request(createApp())
      .put('/api/admin/status/higgsfield')
      .send({ ownerEmail: 'nobody@example.com' })
      .expect(400);
    expect(refused.body).toEqual({ error: { code: 'owner_not_found' } });
  });

  it('refuses the Higgsfield setup to a signed-in user without admin access', async () => {
    mockUser = { id: 'user-1', role: 'USER' };
    await request(createApp()).get('/api/admin/status/higgsfield').expect(403);
    await request(createApp())
      .put('/api/admin/status/higgsfield')
      .send({ ownerEmail: null })
      .expect(403);
  });

  it('refuses an anonymous request', async () => {
    mockUser = null;
    await request(createApp()).get('/api/admin/status').expect(401);

    expect(mockService.get).not.toHaveBeenCalled();
  });
});
