import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createModels, createMethods } from '@librechat/data-schemas';
import { processModelData } from '~/utils/tokens';
import { applyPriceMultiplier } from './markup';
import { grantBalance } from './packs';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));

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
  await mongoose.models.Transaction.deleteMany({});
});

describe('grantBalance against MongoDB', () => {
  const userId = new mongoose.Types.ObjectId().toString();
  const pack = { id: 'starter', label: 'Starter', credits: 2_000_000 };

  it('creates the balance, records a pack transaction and persists the pack fields', async () => {
    const result = await grantBalance(db, { userId, credits: pack.credits, pack });

    expect(result.balance).toBe(2_000_000);
    const balance = await db.findBalanceByUser(userId);
    expect(balance).toMatchObject({
      tokenCredits: 2_000_000,
      packId: 'starter',
      packLabel: 'Starter',
      packAllotment: 2_000_000,
    });
    expect(balance?.packGrantedAt).toBeInstanceOf(Date);

    const [tx] = await mongoose.models.Transaction.find({ user: userId }).lean();
    expect(tx).toMatchObject({ tokenType: 'credits', context: 'pack', rawAmount: 2_000_000 });
  });

  it('carries leftover credits into the next allotment', async () => {
    await grantBalance(db, { userId, credits: pack.credits, pack });
    /** Spend 1.5M credits the way chat usage does: a negative ledger entry */
    await db.createTransaction({
      user: userId,
      tokenType: 'credits',
      context: 'test-spend',
      rawAmount: -1_500_000,
      balance: { enabled: true },
    });

    const second = await grantBalance(db, { userId, credits: pack.credits, pack });

    expect(second.balance).toBe(2_500_000);
    expect(second.packAllotment).toBe(2_500_000);
    const balance = await db.findBalanceByUser(userId);
    expect(balance?.packAllotment).toBe(2_500_000);
  });
});

describe('chat spend at marked-up OpenRouter prices', () => {
  const userId = new mongoose.Types.ObjectId().toString();
  const model = '~google/gemini-flash-latest';

  it('deducts tokens x OpenRouter USD price x priceMultiplier from the pack', async () => {
    /** Shape of an OpenRouter /models entry: USD per token as strings */
    const fetched = processModelData({
      data: [
        {
          id: model,
          pricing: { prompt: '0.00000075', completion: '0.00000375' },
          context_length: 1048576,
        },
      ],
    });
    const endpointTokenConfig = applyPriceMultiplier(fetched, 1.3);
    await grantBalance(db, {
      userId,
      credits: 2_000_000,
      pack: { id: 'starter', label: 'Starter', credits: 2_000_000 },
    });

    await db.spendTokens(
      {
        user: userId,
        model,
        context: 'message',
        conversationId: 'convo-1',
        balance: { enabled: true },
        endpointTokenConfig,
      },
      { promptTokens: 1000, completionTokens: 500 },
    );

    /** 1000 x $0.75/M x 1.3 + 500 x $3.75/M x 1.3 = 975 + 2437.5 credits */
    const balance = await db.findBalanceByUser(userId);
    expect(balance?.tokenCredits).toBeCloseTo(2_000_000 - 3412.5, 5);
    expect(balance?.packAllotment).toBe(2_000_000);
  });
});
