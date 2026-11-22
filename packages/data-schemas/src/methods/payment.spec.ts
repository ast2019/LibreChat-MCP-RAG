import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { ITransaction } from '~/schema/transaction';
import type { IPaymentOrder } from '~/types';
import { createPaymentMethods, paymentLedgerMarker, PAYMENT_LEDGER_INDEX } from './payment';
import logger from '~/config/winston';
import { createModels } from '~/models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let Transaction: mongoose.Model<ITransaction>;
let PaymentOrder: mongoose.Model<IPaymentOrder>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  Object.assign(mongoose.models, createModels(mongoose));
  Transaction = mongoose.models.Transaction;
  PaymentOrder = mongoose.models.PaymentOrder;
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await Transaction.collection.drop().catch(() => undefined);
  await PaymentOrder.deleteMany({});
  jest.clearAllMocks();
});

const user = new mongoose.Types.ObjectId();
const orderId = new mongoose.Types.ObjectId().toString();

const paymentCredit = (messageId = paymentLedgerMarker(orderId)) => ({
  user,
  tokenType: 'credits' as const,
  context: 'pack',
  rawAmount: 2_000_000,
  messageId,
});

describe('payment ledger guard', () => {
  it('refuses a second credit transaction for the same order', async () => {
    const methods = createPaymentMethods(mongoose);
    expect(await methods.hasPaymentLedgerEntry(user.toString(), orderId)).toBe(false);

    await Transaction.create(paymentCredit());
    await expect(Transaction.create(paymentCredit())).rejects.toMatchObject({ code: 11000 });

    expect(await methods.hasPaymentLedgerEntry(user.toString(), orderId)).toBe(true);
    const indexes = await Transaction.collection.indexes();
    expect(indexes.find((index) => index.name === PAYMENT_LEDGER_INDEX)).toMatchObject({
      unique: true,
      partialFilterExpression: { context: 'pack', messageId: { $type: 'string' } },
    });
  });

  it('leaves usage and manual grants out of the guard', async () => {
    const methods = createPaymentMethods(mongoose);
    await methods.hasPaymentLedgerEntry(user.toString(), orderId);

    const usage = { user, tokenType: 'prompt' as const, rawAmount: -10, messageId: 'msg-1' };
    await Transaction.create(usage);
    await Transaction.create(usage);
    const manual = { user, tokenType: 'credits' as const, context: 'pack', rawAmount: 5 };
    await Transaction.create(manual);
    await Transaction.create(manual);

    expect(await Transaction.countDocuments({ user })).toBe(4);
  });

  it('keeps crediting and names the orders when existing data already holds a duplicate', async () => {
    await Transaction.create(paymentCredit());
    await Transaction.create(paymentCredit());
    const methods = createPaymentMethods(mongoose);

    await expect(methods.hasPaymentLedgerEntry(user.toString(), orderId)).resolves.toBe(true);

    const indexes = await Transaction.collection.indexes();
    expect(indexes.some((index) => index.name === PAYMENT_LEDGER_INDEX)).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('credited more than once'), {
      markers: [paymentLedgerMarker(orderId)],
    });
  });
});

describe('closed orders', () => {
  const base = {
    user,
    packId: 'starter',
    packLabel: 'Starter',
    credits: 1,
    amountRial: 10,
    gateway: 'zarinpal' as const,
  };

  it('settles an order closed as unpaid, but not one closed for an amount mismatch', async () => {
    const methods = createPaymentMethods(mongoose);
    const unpaid = await PaymentOrder.create({
      ...base,
      status: 'canceled',
      errorCode: 'canceled',
      authority: 'A1111111111',
      expiresAt: new Date(),
    });
    const mismatch = await PaymentOrder.create({
      ...base,
      status: 'failed',
      errorCode: 'amount_mismatch',
      authority: 'A2222222222',
      expiresAt: new Date(),
    });
    const settlement = (referenceId: string) => ({
      referenceId,
      paidAt: new Date(),
      leaseUntil: new Date(Date.now() + 60_000),
    });

    expect(await methods.settlePaymentOrder(unpaid._id.toString(), settlement('r1'))).toMatchObject(
      { status: 'paid', referenceId: 'r1' },
    );
    expect(await methods.settlePaymentOrder(mismatch._id.toString(), settlement('r2'))).toBeNull();
  });

  it('lists a recent unpaid closed order for re-verification once, after its expiry', async () => {
    const methods = createPaymentMethods(mongoose);
    const now = new Date();
    const order = await PaymentOrder.create({
      ...base,
      status: 'canceled',
      errorCode: 'canceled',
      authority: 'A3333333333',
      expiresAt: new Date(now.getTime() - 1000),
    });
    const since = new Date(now.getTime() - 60_000);

    expect(await methods.listPaymentOrdersToReconcile({ now })).toHaveLength(0);
    const listed = await methods.listPaymentOrdersToReconcile({ now, reverifyClosedSince: since });
    expect(listed.map((row) => row.id)).toEqual([order._id.toString()]);

    await methods.markPaymentOrderReverified(order._id.toString(), now);
    expect(
      await methods.listPaymentOrdersToReconcile({ now, reverifyClosedSince: since }),
    ).toHaveLength(0);
  });
});
