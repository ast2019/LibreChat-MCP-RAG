import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createBillingMethods } from './billing';
import { createModels } from '~/models';

let mongoServer: MongoMemoryServer;
let billing: ReturnType<typeof createBillingMethods>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  billing = createBillingMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('billing methods', () => {
  const now = new Date('2026-10-25T12:00:00Z');
  const old = new Date('2026-08-01T12:00:00Z');
  let saraId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    const [sara, reza] = await mongoose.models.User.create([
      { name: 'Sara', username: 'sara', email: 'sara@example.com', provider: 'local' },
      { name: 'Reza', username: 'reza', email: 'reza@example.com', provider: 'local' },
    ]);
    saraId = sara._id;
    await mongoose.models.Balance.create([
      {
        user: sara._id,
        tokenCredits: 1_500_000,
        packId: 'starter',
        packLabel: 'Starter',
        packAllotment: 2_000_000,
      },
    ]);
    const tx = mongoose.connection.collection('transactions');
    await tx.insertMany([
      {
        user: sara._id,
        tokenType: 'credits',
        context: 'pack',
        rawAmount: 2e6,
        tokenValue: 2e6,
        createdAt: now,
      },
      {
        user: reza._id,
        tokenType: 'credits',
        context: 'admin',
        rawAmount: 5e5,
        tokenValue: 5e5,
        createdAt: old,
      },
      {
        user: sara._id,
        tokenType: 'prompt',
        model: 'm1',
        rawAmount: -1000,
        tokenValue: -400_000,
        createdAt: now,
      },
      {
        user: sara._id,
        tokenType: 'completion',
        model: 'm1',
        rawAmount: -500,
        tokenValue: -100_000,
        createdAt: now,
      },
      {
        user: reza._id,
        tokenType: 'prompt',
        model: 'm2',
        rawAmount: -10,
        tokenValue: -9_000,
        createdAt: old,
      },
    ]);
  });

  it('lists users with their balance, newest first, and searches', async () => {
    const all = await billing.listUsersWithBalances({});
    expect(all.total).toBe(2);
    const sara = all.users.find((u) => u.email === 'sara@example.com');
    expect(sara?.balance).toMatchObject({ tokenCredits: 1_500_000, packLabel: 'Starter' });
    expect(all.users.find((u) => u.email === 'reza@example.com')?.balance).toBeNull();

    const found = await billing.listUsersWithBalances({ search: 'sara' });
    expect(found.users.map((u) => u.id)).toEqual([saraId.toString()]);
  });

  it('summarizes grants, spend and outstanding credits for a window', async () => {
    const summary = await billing.getBillingSummary({ since: new Date('2026-10-01T00:00:00Z') });
    expect(summary).toEqual({
      totalUsers: 2,
      activeUsers: 1,
      creditsGranted: 2_500_000,
      creditsGrantedInWindow: 2_000_000,
      packGrantsInWindow: 1,
      creditsSpentInWindow: 500_000,
      creditsOutstanding: 1_500_000,
      topModels: [{ model: 'm1', credits: 500_000 }],
    });
  });
});
