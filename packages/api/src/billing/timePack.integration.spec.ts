import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createModels, createMethods } from '@librechat/data-schemas';
import { getActiveTimePackEntitlement } from 'librechat-data-provider';
import type { TBalancePack } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { AdminBalanceDeps } from './handlers';
import {
  syncUserTimePackFromBalance,
  applyGrantedTimePackToUser,
  grantTimePack,
} from './timePack';
import { createAdminBalanceHandlers } from './handlers';
import { applyTimePackSpecs } from '~/app/admin';

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
function routeDeps(options?: { concurrentBalanceReads?: number }): AdminBalanceDeps {
  const findBalance =
    options?.concurrentBalanceReads != null && options.concurrentBalanceReads > 1
      ? readTogether(options.concurrentBalanceReads, (userId: string) =>
          db.findBalanceByUser(userId),
        )
      : (userId: string) => db.findBalanceByUser(userId);
  return {
    getBalanceConfig: async () => ({ enabled: true, packs: [timePack] }),
    findUserByEmail: async () => null,
    findUserById: async (id) => {
      const user = await db.findUser({ _id: id }, '_id email');
      return user ? { id: user._id.toString(), email: user.email } : null;
    },
    findBalanceByUser: findBalance,
    createTransaction: db.createTransaction,
    upsertBalanceFields: db.upsertBalanceFields,
    extendTimePack: db.extendBalanceTimePack,
    setUserTimePack: db.setUserTimePack,
    getUserTimePackFields: (userId) =>
      db.getUserById(
        userId,
        'timePackId timePackLabel timePackEndpoint timePackExpiresAt timePackGrantedAt',
      ),
    listUsersWithBalances: db.listUsersWithBalances,
    getBillingSummary: db.getBillingSummary,
    getPriceMultiplier: async () => undefined,
  };
}

const modelConfig = {
  modelSpecs: {
    list: [
      { name: 'smart', group: 'Claude', preset: { endpoint: 'OpenRouter' } },
      { name: 'gpt', group: 'ChatGPT', preset: { endpoint: 'OpenRouter' } },
      {
        name: 'time-smart',
        group: 'Claude',
        timePack: true,
        preset: { endpoint: 'ClaudeTime' },
      },
    ],
  },
} as AppConfig;

describe('time-pack grant against MongoDB', () => {
  it('keeps both durations when two grants for one user run at once', async () => {
    const user = await mongoose.models.User.create({ email: 'race@b.co', provider: 'local' });
    const userId = user._id.toString();
    const start = Date.now();
    const handlers = createAdminBalanceHandlers(routeDeps({ concurrentBalanceReads: 2 }));
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

  it('after a grant, user entitlement hides OpenRouter Claude and shows ClaudeTime', async () => {
    const user = await mongoose.models.User.create({ email: 'ok@b.co', provider: 'local' });
    const userId = user._id.toString();
    const handlers = createAdminBalanceHandlers(routeDeps());
    const res = mockRes();
    await handlers.grant(
      { body: { userId, packId: timePack.id }, user: { id: 'admin' } } as unknown as Parameters<
        typeof handlers.grant
      >[0],
      res,
    );
    expect(res.statusCode).toBe(200);

    const stored = await db.getUserById(
      userId,
      'timePackId timePackEndpoint timePackExpiresAt timePackLabel timePackGrantedAt',
    );
    expect(getActiveTimePackEntitlement(stored ?? undefined)).not.toBeNull();
    expect(applyTimePackSpecs(modelConfig, true).modelSpecs?.list?.map((s) => s.name)).toEqual([
      'gpt',
      'time-smart',
    ]);
    expect(applyTimePackSpecs(modelConfig, false).modelSpecs?.list?.map((s) => s.name)).toEqual([
      'smart',
      'gpt',
    ]);
  });

  it('repairs a balance-only orphan so ClaudeTime becomes visible', async () => {
    const user = await mongoose.models.User.create({ email: 'orphan@b.co', provider: 'local' });
    const userId = user._id.toString();
    const expiresAt = new Date(Date.now() + 30 * DAY_MS);
    await mongoose.models.Balance.create({
      user: userId,
      tokenCredits: 100,
      timePackId: 'claude-time',
      timePackLabel: 'Claude month',
      timePackEndpoint: 'ClaudeTime',
      timePackExpiresAt: expiresAt,
      timePackGrantedAt: new Date(),
      timePackRevision: 2,
    });

    expect(getActiveTimePackEntitlement(user.toObject())).toBeNull();

    const synced = await syncUserTimePackFromBalance(
      { findBalanceByUser: db.findBalanceByUser, setUserTimePack: db.setUserTimePack },
      userId,
      {},
    );
    expect(synced?.timePackId).toBe('claude-time');

    const reqUser = { id: userId } as {
      id: string;
      timePackId?: string | null;
      timePackEndpoint?: string | null;
      timePackExpiresAt?: Date | string | null;
      timePackLabel?: string | null;
      timePackGrantedAt?: Date | string | null;
    };
    applyGrantedTimePackToUser(reqUser, synced!);
    expect(getActiveTimePackEntitlement(reqUser)).not.toBeNull();
    expect(
      applyTimePackSpecs(modelConfig, getActiveTimePackEntitlement(reqUser) != null).modelSpecs
        ?.list?.map((s) => s.name),
    ).toEqual(['gpt', 'time-smart']);

    const stored = await db.getUserById(userId, 'timePackId timePackEndpoint timePackExpiresAt');
    expect(stored?.timePackId).toBe('claude-time');
  });

  it('repairs a legacy balance row that has dates but no timePackRevision', async () => {
    const user = await mongoose.models.User.create({ email: 'legacy@b.co', provider: 'local' });
    const userId = user._id.toString();
    await mongoose.models.Balance.create({
      user: userId,
      tokenCredits: 50,
      timePackId: 'claude-time',
      timePackLabel: 'Claude month',
      timePackEndpoint: 'ClaudeTime',
      timePackExpiresAt: new Date(Date.now() + 10 * DAY_MS),
      timePackGrantedAt: new Date(),
    });

    const synced = await syncUserTimePackFromBalance(
      { findBalanceByUser: db.findBalanceByUser, setUserTimePack: db.setUserTimePack },
      userId,
      {},
    );
    expect(synced?.timePackRevision).toBe(1);
    const stored = await db.getUserById(userId, 'timePackId timePackEndpoint');
    expect(stored?.timePackEndpoint).toBe('ClaudeTime');
  });

  it('grants onto an existing balance that never had time-pack fields', async () => {
    const user = await mongoose.models.User.create({ email: 'credit@b.co', provider: 'local' });
    const userId = user._id.toString();
    await mongoose.models.Balance.create({ user: userId, tokenCredits: 999 });

    await grantTimePack(
      {
        extendTimePack: db.extendBalanceTimePack,
        setUserTimePack: db.setUserTimePack,
        getUserTimePackFields: (id) =>
          db.getUserById(
            id,
            'timePackId timePackLabel timePackEndpoint timePackExpiresAt timePackGrantedAt',
          ),
      },
      { userId, pack: timePack, durationDays: 30, endpoint: 'ClaudeTime' },
    );

    const balance = await db.findBalanceByUser(userId);
    expect(balance?.tokenCredits).toBe(999);
    expect(balance?.timePackEndpoint).toBe('ClaudeTime');
    expect(balance?.timePackRevision).toBe(1);
    const stored = await db.getUserById(userId, 'timePackId timePackEndpoint timePackExpiresAt');
    expect(getActiveTimePackEntitlement(stored ?? undefined)).not.toBeNull();
  });
});
