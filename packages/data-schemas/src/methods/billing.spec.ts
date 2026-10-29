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
      {
        name: 'Sara',
        username: 'sara',
        email: 'sara@example.com',
        provider: 'local',
        modelAccess: { local: false },
      },
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

  it('splits one user’s spend by what it paid for, leaving grants and other users out', async () => {
    const tx = mongoose.connection.collection('transactions');
    await tx.insertMany([
      {
        user: saraId,
        tokenType: 'prompt',
        context: 'memory',
        model: 'flash',
        rawAmount: -100,
        tokenValue: -30_000,
        createdAt: now,
      },
      {
        user: saraId,
        tokenType: 'credits',
        context: 'ocr_local',
        rawAmount: -250,
        tokenValue: -250,
        createdAt: now,
      },
      {
        user: saraId,
        tokenType: 'credits',
        context: 'tts',
        rawAmount: -2_000,
        tokenValue: -2_000,
        createdAt: now,
      },
    ]);
    const usage = await billing.getUserUsageByContext({
      userId: saraId.toString(),
      since: new Date('2026-10-01T00:00:00Z'),
    });
    /** The m1 prompt and completion rows have no context: one call under `other` */
    expect(usage.byContext).toEqual([
      { context: 'other', credits: 500_000, count: 1 },
      { context: 'memory', credits: 30_000, count: 1 },
      { context: 'tts', credits: 2_000, count: 1 },
      { context: 'ocr_local', credits: 250, count: 1 },
    ]);
    expect(usage.totalCredits).toBe(532_250);
    expect(usage.byModel[0]).toEqual({ model: 'm1', credits: 500_000 });
    await tx.deleteMany({ context: { $in: ['memory', 'ocr_local', 'tts'] } });
  });

  it('lists users with their balance, newest first, and searches', async () => {
    const all = await billing.listUsersWithBalances({});
    expect(all.total).toBe(2);
    const sara = all.users.find((u) => u.email === 'sara@example.com');
    expect(sara?.balance).toMatchObject({ tokenCredits: 1_500_000, packLabel: 'Starter' });
    expect(all.users.find((u) => u.email === 'reza@example.com')?.balance).toBeNull();
    expect(sara?.modelAccess).toEqual({ local: false });
    expect(all.users.find((u) => u.email === 'reza@example.com')?.modelAccess).toEqual({});

    const found = await billing.listUsersWithBalances({ search: 'sara' });
    expect(found.users.map((u) => u.id)).toEqual([saraId.toString()]);
  });

  it('lists phone-only users and finds them by any mobile spelling', async () => {
    const phoneUser = await mongoose.models.User.create({
      name: 'Mina',
      phone: '+989121234567',
      provider: 'local',
    });
    try {
      const found = await billing.listUsersWithBalances({ search: '۰۹۱۲ ۱۲۳ ۴۵۶۷' });
      expect(found.users).toHaveLength(1);
      expect(found.users[0]).toMatchObject({
        id: phoneUser._id.toString(),
        email: '',
        phone: '+989121234567',
      });
      const all = await billing.listUsersWithBalances({});
      expect(all.users.find((u) => u.email === 'sara@example.com')?.phone).toBe('');
    } finally {
      await mongoose.models.User.deleteOne({ _id: phoneUser._id });
    }
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
      creditsSpentLocalInWindow: 0,
      creditsOutstanding: 1_500_000,
      topModels: [{ model: 'm1', credits: 500_000 }],
    });
  });

  it('counts OCR spend: vision tokens like chat, local pages as no-provider-cost spend', async () => {
    const tx = mongoose.connection.collection('transactions');
    const ocrSince = new Date('2026-10-20T00:00:00Z');
    await tx.insertMany([
      {
        user: saraId,
        tokenType: 'prompt',
        context: 'ocr',
        model: 'google/gemini-3.8-flash',
        endpoint: 'OpenRouter',
        rawAmount: -3600,
        tokenValue: -2340,
        createdAt: now,
      },
      {
        user: saraId,
        tokenType: 'credits',
        context: 'ocr_local',
        model: 'tesseract',
        rawAmount: -750,
        tokenValue: -750,
        createdAt: now,
      },
    ]);
    const summary = await billing.getBillingSummary({ since: ocrSince });
    expect(summary.creditsSpentInWindow).toBe(500_000 + 2340 + 750);
    expect(summary.creditsSpentLocalInWindow).toBe(750);
    /** Grants stay grants: a negative `credits` row of another context is not counted. */
    expect(summary.creditsGrantedInWindow).toBe(2_000_000);
    expect(summary.topModels).toEqual(
      expect.arrayContaining([
        { model: 'google/gemini-3.8-flash', credits: 2340 },
        { model: 'tesseract', credits: 750 },
      ]),
    );
    await tx.deleteMany({ context: { $in: ['ocr', 'ocr_local'] } });
  });
});
