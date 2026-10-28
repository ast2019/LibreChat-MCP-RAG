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
/** Grants `access:admin` to admins only, as the capability store does by default. */
const mockRequireCapability = jest.fn(
  (capability) => (req, res, next) =>
    capability === 'access:admin' && req.user?.role === 'ADMIN'
      ? next()
      : res.status(403).json({ message: 'Forbidden' }),
);
const mockService = {
  get: jest.fn(async () => ({ services: [], chain: [] })),
  refresh: jest.fn(async () => ({ services: [{ id: 'serper' }], chain: [] })),
};

jest.mock('@librechat/data-schemas', () => ({
  SystemCapabilities: { ACCESS_ADMIN: 'access:admin' },
}));
jest.mock('@librechat/api', () => {
  const { createAdminStatusHandlers } = jest.requireActual('@librechat/api');
  return { createAdminStatusHandlers };
});
jest.mock('~/server/middleware/roles/capabilities', () => ({
  requireCapability: mockRequireCapability,
}));
jest.mock('~/server/middleware', () => ({ requireJwtAuth: mockRequireJwtAuth }));
jest.mock('~/server/services/ServiceStatus', () => ({ getServiceStatus: () => mockService }));

function createApp() {
  const router = require('./status');
  const app = express();
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

  it('refuses an anonymous request', async () => {
    mockUser = null;
    await request(createApp()).get('/api/admin/status').expect(401);

    expect(mockService.get).not.toHaveBeenCalled();
  });
});
