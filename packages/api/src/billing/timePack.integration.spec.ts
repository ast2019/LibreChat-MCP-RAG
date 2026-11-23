import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createModels, createMethods } from '@librechat/data-schemas';
import type { TBalancePack } from 'librechat-data-provider';
import type { Response } from 'express';
import type { AdminBalanceDeps } from './handlers';
import { createAdminBalanceHandlers } from './handlers';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));

const DAY_MS = 24 * 60 * 60 * 1000;
const timePack: TBalancePack = {
  id: 'claude-time',
  label: 'Claude month',
  kind: 'time',
  durationDays: 30,
  endpoint: 'ClaudeTime',
};

let mongoServer: MongoMemoryServer;
let db: ReturnType<typeof createMethods>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  db = createMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await mongoose.models.Balance.deleteMany({});
  await mongoose.models.User.deleteMany({});
});

/** Holds the first `count` calls until all of them arrived, so two requests read together. */
function readTogether<A extends unknown[], R>(count: number, read: (...args: A) => Promise<R>) {
  let waiting: Array<() => void> = [];
  let held = 0;
  return async (...args: A): Promise<R> => {
    if (held < count) {
      held += 1;
      await new Promise<void>((resolve) => {
        waiting.push(resolve);
        if (waiting.length === count) {
          waiting.forEach((release) => release());
          waiting = [];
        }
      });
    }
    return read(...args);
  };
}

function mockRes() {
  const res = {} as Response & { statusCode?: number; body?: unknown };
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  }) as unknown as Response['status'];
  res.json = jest.fn((body: unknown) => {
    res.body = body;
    return res;
  }) as unknown as Response['json'];
  return res;
}

/** The admin route's data wiring (api/server/routes/admin/balance.js), against MongoDB. */
function routeDeps(): AdminBalanceDeps {
  return {
    getBalanceConfig: async () => ({ enabled: true, packs: [timePack] }),
    findUserByEmail: async () => null,
    findUserById: async (id) => {
      const user = await db.findUser({ _id: id }, '_id email');
      return user ? { id: user._id.toString(), email: user.email } : null;
    },
    findBalanceByUser: readTogether(2, (userId: string) => db.findBalanceByUser(userId)),
    createTransaction: db.createTransaction,
    upsertBalanceFields: db.upsertBalanceFields,
    extendTimePack: db.extendBalanceTimePack,
    setUserTimePack: db.setUserTimePack,
    listUsersWithBalances: db.listUsersWithBalances,
    getBillingSummary: db.getBillingSummary,
    getPriceMultiplier: async () => undefined,
  };
}

describe('time-pack grant against MongoDB', () => {
  it('keeps both durations when two grants for one user run at once', async () => {
    const user = await mongoose.models.User.create({ email: 'race@b.co', provider: 'local' });
    const userId = user._id.toString();
    const start = Date.now();
    const handlers = createAdminBalanceHandlers(routeDeps());
    const grant = async () => {
      const res = mockRes();
      await handlers.grant(
        { body: { userId, packId: timePack.id }, user: { id: 'admin' } } as unknown as Parameters<
          typeof handlers.grant
        >[0],
        res,
      );
      return res;
    };

    const responses = await Promise.all([grant(), grant()]);

    expect(responses.map((res) => res.statusCode)).toEqual([200, 200]);
    const balance = await db.findBalanceByUser(userId);
    const expiresAt = balance?.timePackExpiresAt?.getTime() ?? 0;
    /** 60 days from the grants, not 30: neither grant overwrote the other. */
    expect(expiresAt - start).toBeGreaterThanOrEqual(60 * DAY_MS - 60_000);
    expect(expiresAt - start).toBeLessThanOrEqual(60 * DAY_MS + 60_000);
    const stored = await mongoose.models.User.findById(userId).lean<{
      timePackExpiresAt?: Date;
    }>();
    expect(stored?.timePackExpiresAt?.getTime()).toBe(expiresAt);
  });
});
