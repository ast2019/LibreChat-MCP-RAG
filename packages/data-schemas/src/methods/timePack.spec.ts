import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { AUTH_USER_DOC_BY_ID_PREFIX } from 'librechat-data-provider';
import type * as t from '~/types';
import { createTransactionMethods } from './transaction';
import balanceSchema from '~/schema/balance';
import { createUserMethods } from './user';
import userSchema from '~/schema/user';

jest.mock('~/crypto', () => ({
  signPayload: jest.fn().mockResolvedValue('mocked-token'),
}));

const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date('2026-01-10T00:00:00.000Z');

let mongoServer: MongoMemoryServer;
let User: mongoose.Model<t.IUser>;
let Balance: mongoose.Model<t.IBalance>;
let balances: ReturnType<typeof createTransactionMethods>;

const grant = (over: Partial<t.TimePackGrant> = {}): t.TimePackGrant => ({
  timePackId: 'claude-time',
  timePackLabel: 'Claude month',
  timePackEndpoint: 'ClaudeTime',
  durationDays: 30,
  now,
  ...over,
});

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  User = mongoose.models.User || mongoose.model<t.IUser>('User', userSchema);
  Balance = mongoose.models.Balance || mongoose.model<t.IBalance>('Balance', balanceSchema);
  balances = createTransactionMethods(mongoose, {
    getMultiplier: () => 1,
    getCacheMultiplier: () => null,
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await Balance.deleteMany({});
  await User.deleteMany({});
  delete process.env.AUTH_USER_CACHE_MODE;
});

describe('extendBalanceTimePack', () => {
  it('keeps both durations when two grants race on the same user', async () => {
    const user = new mongoose.Types.ObjectId();
    await Balance.create({
      user,
      tokenCredits: 0,
      timePackEndpoint: 'ClaudeTime',
      timePackExpiresAt: new Date(now.getTime() + 20 * DAY_MS),
    });

    const results = await Promise.all([
      balances.extendBalanceTimePack(user.toString(), grant()),
      balances.extendBalanceTimePack(user.toString(), grant()),
    ]);

    const record = await Balance.findOne({ user }).lean();
    expect(record?.timePackExpiresAt?.toISOString()).toBe(
      new Date(now.getTime() + 80 * DAY_MS).toISOString(),
    );
    expect(record?.timePackRevision).toBe(2);
    expect(results.map((result) => result.timePackRevision).sort()).toEqual([1, 2]);
    const last = results.find((result) => result.timePackRevision === 2);
    expect(last?.timePackExpiresAt.toISOString()).toBe(record?.timePackExpiresAt?.toISOString());
  });

  it('adds every duration when several grants race, each with its own revision', async () => {
    const user = new mongoose.Types.ObjectId();
    await Balance.create({ user, tokenCredits: 0 });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => balances.extendBalanceTimePack(user.toString(), grant())),
    );

    const record = await Balance.findOne({ user }).lean();
    expect(record?.timePackExpiresAt?.toISOString()).toBe(
      new Date(now.getTime() + 150 * DAY_MS).toISOString(),
    );
    expect(results.map((result) => result.timePackRevision).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('starts from now when the pack expired or is on another endpoint', async () => {
    const expired = new mongoose.Types.ObjectId();
    const other = new mongoose.Types.ObjectId();
    await Balance.create([
      {
        user: expired,
        tokenCredits: 5,
        timePackEndpoint: 'ClaudeTime',
        timePackExpiresAt: new Date(now.getTime() - DAY_MS),
      },
      {
        user: other,
        tokenCredits: 5,
        timePackEndpoint: 'OtherTime',
        timePackExpiresAt: new Date(now.getTime() + 90 * DAY_MS),
      },
    ]);

    for (const user of [expired, other]) {
      const result = await balances.extendBalanceTimePack(user.toString(), grant());
      expect(result.timePackExpiresAt.toISOString()).toBe('2026-02-09T00:00:00.000Z');
      const record = await Balance.findOne({ user }).lean();
      expect(record?.tokenCredits).toBe(5);
      expect(record?.timePackEndpoint).toBe('ClaudeTime');
    }
  });

  it('creates the balance record when the user has none', async () => {
    const user = new mongoose.Types.ObjectId();
    const result = await balances.extendBalanceTimePack(user.toString(), grant());
    expect(result).toEqual({
      timePackId: 'claude-time',
      timePackLabel: 'Claude month',
      timePackEndpoint: 'ClaudeTime',
      timePackExpiresAt: new Date('2026-02-09T00:00:00.000Z'),
      timePackGrantedAt: now,
      timePackRevision: 1,
    });
    expect(await Balance.countDocuments({ user })).toBe(1);
  });

  it('stores operator strings literally', async () => {
    const user = new mongoose.Types.ObjectId();
    const result = await balances.extendBalanceTimePack(
      user.toString(),
      grant({ timePackLabel: '$timePackId', timePackEndpoint: '$timePackLabel' }),
    );
    const record = await Balance.findOne({ user }).lean();
    expect(record?.timePackLabel).toBe('$timePackId');
    expect(record?.timePackEndpoint).toBe('$timePackLabel');
    expect(result.timePackEndpoint).toBe('$timePackLabel');
  });

  it('rejects a non-positive duration', async () => {
    const user = new mongoose.Types.ObjectId().toString();
    await expect(balances.extendBalanceTimePack(user, grant({ durationDays: 0 }))).rejects.toThrow(
      'positive durationDays',
    );
  });
});

describe('setUserTimePack', () => {
  const granted = (revision: number, days: number): t.GrantedTimePack => ({
    timePackId: 'claude-time',
    timePackLabel: 'Claude month',
    timePackEndpoint: 'ClaudeTime',
    timePackExpiresAt: new Date(now.getTime() + days * DAY_MS),
    timePackGrantedAt: now,
    timePackRevision: revision,
  });

  it('keeps the latest revision when copies land out of order', async () => {
    const users = createUserMethods(mongoose);
    const user = await User.create({ email: 'a@b.co', provider: 'local' });
    const id = user._id.toString();

    expect(await users.setUserTimePack(id, granted(2, 60))).toBe(true);
    expect(await users.setUserTimePack(id, granted(1, 30))).toBe(false);

    const stored = await User.findById(id).select('+timePackRevision').lean();
    expect(new Date(stored?.timePackExpiresAt ?? 0).toISOString()).toBe(
      new Date(now.getTime() + 60 * DAY_MS).toISOString(),
    );
    expect(stored?.timePackRevision).toBe(2);
  });

  it('applies over a user without a revision and invalidates the cached auth user', async () => {
    process.env.AUTH_USER_CACHE_MODE = 'on';
    const cache = { get: jest.fn().mockResolvedValue(undefined), delete: jest.fn() };
    const users = createUserMethods(mongoose, { getCache: () => cache as never });
    const user = await User.create({
      email: 'c@d.co',
      provider: 'local',
      timePackEndpoint: 'ClaudeTime',
      timePackExpiresAt: new Date(now.getTime() + DAY_MS),
    });
    const id = user._id.toString();

    expect(await users.setUserTimePack(id, granted(1, 31))).toBe(true);

    expect(cache.get).toHaveBeenCalledWith(`${AUTH_USER_DOC_BY_ID_PREFIX}:${id}`);
    const stored = await User.findById(id).lean();
    expect(new Date(stored?.timePackExpiresAt ?? 0).toISOString()).toBe(
      new Date(now.getTime() + 31 * DAY_MS).toISOString(),
    );
    expect(stored).not.toHaveProperty('timePackRevision');
  });
});
