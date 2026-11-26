const express = require('express');
const request = require('supertest');

jest.mock('~/models', () => ({
  findBalanceByUser: jest.fn(),
  upsertBalanceFields: jest.fn(),
  setUserTimePack: jest.fn(),
}));

jest.mock('~/server/middleware', () => ({
  requireJwtAuth: (req, res, next) => next(),
}));

jest.mock('~/server/middleware/requireJwtAuth', () => (req, res, next) => next());

let mockAppConfig;
let mockReadTimePackStatus;

jest.mock('@librechat/api', () => {
  const actual = jest.requireActual('@librechat/api');
  return {
    ...actual,
    readTimePackStatus: (...args) => mockReadTimePackStatus(...args),
  };
});

jest.mock('~/server/services/Config', () => ({
  getAppConfig: () => Promise.resolve(mockAppConfig),
}));

const FUTURE = new Date(Date.now() + 30 * 86_400_000).toISOString();
const PAST = new Date(Date.now() - 86_400_000).toISOString();

const holder = (expiry) => ({
  id: 'user-1',
  role: 'USER',
  timePackId: 'claude-time',
  timePackEndpoint: 'ClaudeTime',
  ...(expiry != null && { timePackExpiresAt: expiry }),
});

describe('Balance time-pack status route', () => {
  let app;
  const { getTimePackEntitlement } = require('@librechat/api');

  const buildApp = (user) => {
    const instance = express();
    instance.use(express.json());
    instance.use((req, res, next) => {
      req.user = user;
      next();
    });
    instance.use('/api/balance', require('../balance'));
    return instance;
  };

  beforeAll(() => {
    app = buildApp(holder(FUTURE));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockReadTimePackStatus = jest.fn().mockResolvedValue({
      activeSeats: 2,
      maxSeats: 4,
      holders: 3,
      globalRequests: 30,
      requestsPerMinute: 60,
      userRequests: 5,
      userSharePerMinute: 20,
      windowResetsInMs: 12_000,
    });
    mockAppConfig = {
      balance: {
        enabled: true,
        startBalance: 0,
        packs: [{ id: 'claude-time', kind: 'time', endpoint: 'ClaudeTime', label: 'Claude Time' }],
        timePack: { maxSeats: 4, requestsPerMinute: 60, userSharePerMinute: 20 },
      },
    };
  });

  it('reports the plan capacity to a holder', async () => {
    const response = await request(app).get('/api/balance/time-pack/status');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      active: true,
      activeSeats: 2,
      maxSeats: 4,
      holders: 3,
      globalRequests: 30,
      requestsPerMinute: 60,
      userRequests: 5,
      userSharePerMinute: 20,
    });
    expect(mockReadTimePackStatus).toHaveBeenCalled();
  });

  it('tells a user without the plan that there is nothing to see', async () => {
    const plain = buildApp(holder(null));

    const response = await request(plain).get('/api/balance/time-pack/status');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ active: false });
    expect(mockReadTimePackStatus).not.toHaveBeenCalled();
  });

  it('treats an expired entitlement as no plan at all', async () => {
    const expired = buildApp(holder(PAST));

    const response = await request(expired).get('/api/balance/time-pack/status');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ active: false });
    expect(mockReadTimePackStatus).not.toHaveBeenCalled();
  });

  it('refuses a request without a signed-in user', async () => {
    const anonymous = express();
    anonymous.use(express.json());
    anonymous.use('/api/balance', require('../balance'));

    const response = await request(anonymous).get('/api/balance/time-pack/status');

    expect(response.status).toBe(401);
  });

  it('recognizes the entitlement helper as the holder check', () => {
    const entitlement = getTimePackEntitlement(
      {
        id: 'user-1',
        timePackId: 'claude-time',
        timePackEndpoint: 'ClaudeTime',
        timePackExpiresAt: FUTURE,
      },
      mockAppConfig.balance.packs,
    );
    expect(entitlement?.timePackEndpoint).toBe('ClaudeTime');
  });

  it('syncs a balance-only grant onto the user before reporting capacity', async () => {
    const { findBalanceByUser, setUserTimePack } = require('~/models');
    findBalanceByUser.mockResolvedValue({
      user: 'user-1',
      timePackId: 'claude-time',
      timePackEndpoint: 'ClaudeTime',
      timePackExpiresAt: FUTURE,
      timePackGrantedAt: new Date().toISOString(),
      timePackLabel: 'Claude Time',
      timePackRevision: 1,
    });
    setUserTimePack.mockResolvedValue({ ok: true });

    const plain = buildApp({ id: 'user-1', role: 'USER' });
    const response = await request(plain).get('/api/balance/time-pack/status');

    expect(setUserTimePack).toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      active: true,
      activeSeats: 2,
      maxSeats: 4,
    });
  });
});
