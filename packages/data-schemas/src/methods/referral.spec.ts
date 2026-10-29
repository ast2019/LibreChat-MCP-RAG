import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createReferralMethods, normalizeReferralCode } from './referral';
import userSchema from '~/schema/user';
import transactionSchema from '~/schema/transaction';

let mongoServer: MongoMemoryServer;
let methods: ReturnType<typeof createReferralMethods>;
let User: mongoose.Model<Record<string, unknown>>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  User = (mongoose.models.User ||
    mongoose.model('User', userSchema)) as unknown as mongoose.Model<Record<string, unknown>>;
  if (!mongoose.models.Transaction) {
    mongoose.model('Transaction', transactionSchema);
  }
  await User.syncIndexes();
  methods = createReferralMethods(mongoose);
}, 30000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await User.deleteMany({});
});

const makeUser = async (fields: Record<string, unknown> = {}) =>
  String(
    (
      await User.create({
        email: `${new mongoose.Types.ObjectId().toString()}@example.com`,
        provider: 'local',
        emailVerified: true,
        ...fields,
      })
    )._id,
  );

const DAY = 24 * 60 * 60 * 1000;

describe('referral methods', () => {
  it('gives each user one stable, readable code', async () => {
    const id = await makeUser();
    const code = await methods.getOrCreateReferralCode(id);
    expect(normalizeReferralCode(code)).toBe(code);
    await expect(methods.getOrCreateReferralCode(id)).resolves.toBe(code);
  });

  it('links a new account once and pays its reward once', async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const code = await methods.getOrCreateReferralCode(alice);

    await expect(
      methods.attachReferrer({ inviteeId: bob, code: code.toLowerCase(), maxAgeMs: DAY }),
    ).resolves.toEqual({ ok: true, referrerId: alice });
    await expect(methods.attachReferrer({ inviteeId: bob, code, maxAgeMs: DAY })).resolves.toEqual({
      ok: false,
      reason: 'already_referred',
    });

    const claims = await Promise.all([
      methods.claimReferralReward(bob),
      methods.claimReferralReward(bob),
    ]);
    expect(claims.filter((claim) => claim === alice)).toHaveLength(1);
    await expect(methods.getReferralStats(alice)).resolves.toEqual({ invited: 1, rewarded: 1 });
  });

  it('refuses self-invites, unknown codes and accounts past the window', async () => {
    const alice = await makeUser();
    const code = await methods.getOrCreateReferralCode(alice);
    const old = await makeUser();
    await User.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(old) },
      { $set: { createdAt: new Date(Date.now() - 10 * DAY) } },
    );

    await expect(methods.attachReferrer({ inviteeId: alice, code, maxAgeMs: DAY })).resolves.toEqual(
      { ok: false, reason: 'self' },
    );
    await expect(
      methods.attachReferrer({ inviteeId: old, code: 'ZZZZZZZZ', maxAgeMs: DAY }),
    ).resolves.toEqual({ ok: false, reason: 'invalid_code' });
    await expect(methods.attachReferrer({ inviteeId: old, code, maxAgeMs: DAY })).resolves.toEqual({
      ok: false,
      reason: 'too_old',
    });
  });

  it('lets a failed payment be claimed again', async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    await methods.attachReferrer({
      inviteeId: bob,
      code: await methods.getOrCreateReferralCode(alice),
      maxAgeMs: DAY,
    });
    await expect(methods.claimReferralReward(bob)).resolves.toBe(alice);
    await methods.releaseReferralReward(bob);
    await expect(methods.claimReferralReward(bob)).resolves.toBe(alice);
  });
});
