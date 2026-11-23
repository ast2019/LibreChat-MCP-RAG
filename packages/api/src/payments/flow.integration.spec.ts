import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createModels, createMethods } from '@librechat/data-schemas';
import type { AppConfig, IUser } from '@librechat/data-schemas';
import type { CurrencyRates } from '~/billing/currency';
import { resolvePaymentSettings } from './config';
import { createPaymentHandlers } from './handlers';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));

const AUTHORITY = 'A000000000000000000000000000217885159';
const MERCHANT = '1344b5d4-0048-11e8-94db-005056a205be';
const IDPAY_ID = 'd2e353189823079e1e4181772cff5292';

let mongoServer: MongoMemoryServer;
let db: ReturnType<typeof createMethods>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  db = createMethods(mongoose);
  await mongoose.models.PaymentOrder.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await Promise.all(
    ['Balance', 'Transaction', 'PaymentOrder', 'User'].map((name) =>
      mongoose.models[name].deleteMany({}),
    ),
  );
});

const packs = [
  { id: 'starter', label: 'Starter', credits: 2_000_000 },
  { id: 'pro', label: 'Pro', credits: 15_000_000 },
];

const appConfig = {
  balance: { enabled: true, packs },
  interfaceConfig: { currency: { code: 'IRT', rate: 269_500, priceStep: 1000 } },
  config: {
    payments: {
      enabled: true,
      orderTtlMinutes: 30,
      gateways: {
        zarinpal: { enabled: true, merchantId: '${ZARINPAL_MERCHANT_ID}', sandbox: true },
        idpay: { enabled: true, apiKey: '${IDPAY_API_KEY}', sandbox: true },
      },
    },
  },
} as unknown as AppConfig;

/** The currency `/api/config` would send: the yaml rate (no live source in the test) */
const currencyRates: CurrencyRates = {
  resolve: async (currency) => ({
    currency: currency as { code: string; rate: number; priceStep?: number },
  }),
};

type GatewayReply = { status?: number; body: unknown };

/** A scripted gateway: each URL path answers from its own queue. */
function createGateway() {
  const queues = new Map<string, GatewayReply[]>();
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const reply = (path: string, ...replies: GatewayReply[]) => {
    queues.set(path, [...(queues.get(path) ?? []), ...replies]);
  };
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    calls.push({ path, body: JSON.parse(String(init?.body ?? '{}')) });
    const next = queues.get(path)?.shift() ?? { status: 500, body: null };
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  }) as typeof fetch;
  return { reply, calls, fetchImpl };
}

let currentUser: { id: string; role: string } | null;

const ENV = {
  DOMAIN_SERVER: 'https://hive.example',
  DOMAIN_CLIENT: 'https://hive.example',
  ZARINPAL_MERCHANT_ID: MERCHANT,
  IDPAY_API_KEY: 'idpay-key',
};
/** What the handlers resolve for every order of this app */
const settings = resolvePaymentSettings(appConfig, ENV);

function createApp(gateway: ReturnType<typeof createGateway>, now?: () => Date) {
  const handlers = createPaymentHandlers({
    now,
    getAppConfig: async () => appConfig,
    getTenantAppConfig: async () => appConfig,
    currencyRates,
    store: db,
    /** The full method set, like the route's `db`; the service takes the grant steps it needs */
    grant: {
      ...db,
      setUserPack: (userId, packId) =>
        db.updateUser(userId, { packId }, {}, { preserveExpiresAt: true }),
      findBalance: (userId) => db.findBalanceByUser(userId, { applyReset: false }),
    },
    fetch: gateway.fetchImpl,
    env: ENV,
  });
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => {
    if (currentUser) {
      (req as unknown as { user: Partial<IUser> }).user = currentUser as unknown as IUser;
    }
    next();
  });
  app.get('/api/payments/options', handlers.options as unknown as express.RequestHandler);
  app.post('/api/payments/checkout', handlers.checkout as unknown as express.RequestHandler);
  app.get(
    '/api/payments/callback/:gateway',
    handlers.callback as unknown as express.RequestHandler,
  );
  app.post(
    '/api/payments/callback/:gateway',
    handlers.callback as unknown as express.RequestHandler,
  );
  app.get('/api/payments/orders/:orderId', handlers.getOrder as unknown as express.RequestHandler);
  app.post(
    '/api/payments/admin/orders/:orderId/verify',
    handlers.adminVerify as unknown as express.RequestHandler,
  );
  app.post(
    '/api/payments/admin/reconcile',
    handlers.adminReconcile as unknown as express.RequestHandler,
  );
  app.get('/api/payments/admin/orders', handlers.adminList as unknown as express.RequestHandler);
  app.get(
    '/api/payments/admin/summary',
    handlers.adminSummary as unknown as express.RequestHandler,
  );
  app.get('/api/payments/admin/status', handlers.adminStatus as unknown as express.RequestHandler);
  return { app, handlers };
}

async function createUser() {
  const user = await mongoose.models.User.create({
    email: `buyer-${new mongoose.Types.ObjectId().toString()}@example.com`,
    name: 'Buyer',
    provider: 'local',
  });
  currentUser = { id: user._id.toString(), role: 'USER' };
  return currentUser.id;
}

async function startZarinpal(app: express.Express, gateway: ReturnType<typeof createGateway>) {
  gateway.reply('/pg/v4/payment/request.json', {
    body: { data: { code: 100, message: 'Success', authority: AUTHORITY }, errors: [] },
  });
  const res = await request(app)
    .post('/api/payments/checkout')
    .send({ packId: 'starter', gateway: 'zarinpal', amountRial: 1000 });
  expect(res.status).toBe(200);
  return res.body as { orderId: string; redirectUrl: string; amountRial: number };
}

const ledger = (userId: string) =>
  mongoose.models.Transaction.find({ user: userId }).lean<
    { context: string; rawAmount: number; messageId?: string }[]
  >();

const WRITE_OPS = [
  'insertOne',
  'insertMany',
  'updateOne',
  'updateMany',
  'replaceOne',
  'findOneAndUpdate',
  'findOneAndReplace',
  'bulkWrite',
] as const;
type WriteOp = (typeof WRITE_OPS)[number];
type WriteCall = { model: string; op: WriteOp; n: number };
type CollectionWrites = Record<WriteOp, (...args: unknown[]) => Promise<unknown>>;

/**
 * Routes every write the credit path can make (ledger, balance, user, order) through `hook`, at
 * the driver collection, so a test can fail, crash after, or stall any single write without
 * knowing which method issues it. `run` performs the real write. Returns the restore function.
 */
function interceptWrites(
  hook: (write: WriteCall, run: () => Promise<unknown>) => Promise<unknown>,
): () => void {
  let n = 0;
  const spies = ['Transaction', 'Balance', 'User', 'PaymentOrder'].flatMap((model) => {
    const collection = mongoose.models[model].collection as unknown as CollectionWrites;
    return WRITE_OPS.map((op) => {
      const original = collection[op];
      return jest.spyOn(collection, op).mockImplementation((...args: unknown[]) => {
        n += 1;
        return hook({ model, op, n }, () => original.apply(collection, args));
      });
    });
  });
  return () => spies.forEach((spy) => spy.mockRestore());
}

/** Waits until `count` writes are parked by a stalling hook. */
async function waitForParked(parked: unknown[], count: number) {
  for (let i = 0; i < 500 && parked.length < count; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(parked).toHaveLength(count);
}

/** A paid order whose credit has not run yet, as a settled callback leaves it. */
async function createPaidOrder(userId: string, paidAt: Date) {
  const order = await mongoose.models.PaymentOrder.create({
    user: userId,
    packId: 'starter',
    packLabel: 'Starter',
    credits: 2_000_000,
    amountRial: 5_390_000,
    gateway: 'zarinpal',
    status: 'paid',
    authority: `A${new mongoose.Types.ObjectId().toString()}`,
    referenceId: new mongoose.Types.ObjectId().toString(),
    paidAt,
    expiresAt: new Date(paidAt.getTime() + 30 * 60_000),
  });
  return order._id.toString() as string;
}

/** What a credited order must have left behind: its credits once, its pack, its marker. */
async function creditState(userId: string, orderId: string) {
  const [balance, entries, order, user] = await Promise.all([
    db.findBalanceByUser(userId, { applyReset: false }),
    ledger(userId),
    db.findPaymentOrderById(orderId),
    mongoose.models.User.findById(userId).lean<{ packId?: string }>(),
  ]);
  return {
    tokenCredits: balance?.tokenCredits,
    packId: balance?.packId,
    packAllotment: balance?.packAllotment,
    ledger: entries.map((entry) => entry.messageId),
    credited: order?.credited,
    userPack: user?.packId,
  };
}

describe('payment flow against MongoDB', () => {
  it('lists packs priced by the server', async () => {
    await createUser();
    const { app } = createApp(createGateway());
    const res = await request(app).get('/api/payments/options');
    expect(res.status).toBe(200);
    /** 2M credits = $2 x 269,500 = 539,000 toman = 5,390,000 rial */
    expect(res.body.packs[0]).toEqual({
      id: 'starter',
      label: 'Starter',
      credits: 2_000_000,
      amountRial: 5_390_000,
    });
    expect(res.body.gateways).toEqual([
      { id: 'zarinpal', sandbox: true },
      { id: 'idpay', sandbox: true },
    ]);
    expect(JSON.stringify(res.body)).not.toContain(MERCHANT);
  });

  it('charges the server price, ignores a client amount and stores the authority', async () => {
    const userId = await createUser();
    const gateway = createGateway();
    const { app } = createApp(gateway);

    const checkout = await startZarinpal(app, gateway);

    expect(checkout.amountRial).toBe(5_390_000);
    expect(checkout.redirectUrl).toBe(`https://sandbox.zarinpal.com/pg/StartPay/${AUTHORITY}`);
    expect(gateway.calls[0].body).toMatchObject({
      amount: 5_390_000,
      currency: 'IRR',
      callback_url: `https://hive.example/api/payments/callback/zarinpal?order=${checkout.orderId}`,
    });
    const order = await db.findPaymentOrderById(checkout.orderId);
    expect(order).toMatchObject({
      userId,
      status: 'pending',
      authority: AUTHORITY,
      amountRial: 5_390_000,
      credits: 2_000_000,
      gateway: 'zarinpal',
    });
  });

  it('rejects an unknown pack and a disabled gateway with codes', async () => {
    await createUser();
    const { app } = createApp(createGateway());
    const missing = await request(app)
      .post('/api/payments/checkout')
      .send({ packId: 'nope', gateway: 'zarinpal' });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: { code: 'pack_not_found' } });
    const unknown = await request(app)
      .post('/api/payments/checkout')
      .send({ packId: 'starter', gateway: 'paypal' });
    expect(unknown.body).toEqual({ error: { code: 'gateway_unavailable' } });
  });

  it('closes the order when the gateway refuses the purchase', async () => {
    await createUser();
    const gateway = createGateway();
    gateway.reply('/pg/v4/payment/request.json', {
      status: 400,
      body: { data: [], errors: { code: -10, message: 'secret merchant detail' } },
    });
    const { app } = createApp(gateway);
    const res = await request(app)
      .post('/api/payments/checkout')
      .send({ packId: 'starter', gateway: 'zarinpal' });
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: { code: 'purchase_failed' } });
    expect(JSON.stringify(res.body)).not.toContain('secret');
    const [order] = await mongoose.models.PaymentOrder.find({}).lean<{ status: string }[]>();
    expect(order.status).toBe('failed');
  });

  it('verifies with the order amount, credits once through the pack ledger and redirects', async () => {
    const userId = await createUser();
    const gateway = createGateway();
    const { app } = createApp(gateway);
    const { orderId } = await startZarinpal(app, gateway);
    gateway.reply('/pg/v4/payment/verify.json', {
      body: { data: { code: 100, ref_id: 201, card_pan: '502229******5995' }, errors: [] },
    });

    const res = await request(app).get(
      `/api/payments/callback/zarinpal?order=${orderId}&Authority=${AUTHORITY}&Status=OK`,
    );

    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(
      `https://hive.example/payment/result?status=success&order=${orderId}`,
    );
    expect(gateway.calls[1].body).toEqual({
      merchant_id: MERCHANT,
      authority: AUTHORITY,
      amount: 5_390_000,
    });
    const balance = await db.findBalanceByUser(userId);
    expect(balance).toMatchObject({ tokenCredits: 2_000_000, packId: 'starter' });
    const entries = await ledger(userId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ context: 'pack', rawAmount: 2_000_000 });
    expect(await db.findPaymentOrderById(orderId)).toMatchObject({
      status: 'paid',
      referenceId: '201',
      credited: true,
    });

    const own = await request(app).get(`/api/payments/orders/${orderId}`);
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({ status: 'paid', referenceId: '201', credited: true });
    expect(own.body.cardPan).toBeUndefined();
  });

  it('credits once when two callbacks arrive together (100 then 101)', async () => {
    const userId = await createUser();
    const gateway = createGateway();
    const { app } = createApp(gateway);
    const { orderId } = await startZarinpal(app, gateway);
    gateway.reply(
      '/pg/v4/payment/verify.json',
      { body: { data: { code: 100, ref_id: 201 }, errors: [] } },
      { body: { data: { code: 101, ref_id: 201 }, errors: [] } },
    );
    const url = `/api/payments/callback/zarinpal?order=${orderId}&Authority=${AUTHORITY}&Status=OK`;

    const [first, second] = await Promise.all([request(app).get(url), request(app).get(url)]);

    expect([first.headers.location, second.headers.location]).toEqual(
      expect.arrayContaining([expect.stringContaining('status=success')]),
    );
    expect(await ledger(userId)).toHaveLength(1);
    expect((await db.findBalanceByUser(userId))?.tokenCredits).toBe(2_000_000);

    /** A replayed return after settlement is answered without another credit */
    const replay = await request(app).get(url);
    expect(replay.headers.location).toContain('status=success');
    expect(await ledger(userId)).toHaveLength(1);
  });

  it('verifies a Status=NOK return and cancels only when the gateway says not paid', async () => {
    const userId = await createUser();
    const gateway = createGateway();
    const { app } = createApp(gateway);
    const { orderId } = await startZarinpal(app, gateway);
    gateway.reply('/pg/v4/payment/verify.json', {
      status: 400,
      body: { data: [], errors: { code: -51, message: 'failed' } },
    });

    const res = await request(app).get(
      `/api/payments/callback/zarinpal?order=${orderId}&Authority=${AUTHORITY}&Status=NOK`,
    );

    expect(res.headers.location).toContain('status=failed');
    expect(res.headers.location).toContain('code=canceled');
    expect(gateway.calls.map((call) => call.path)).toEqual([
      '/pg/v4/payment/request.json',
      '/pg/v4/payment/verify.json',
    ]);
    expect(await db.findPaymentOrderById(orderId)).toMatchObject({
      status: 'canceled',
      errorCode: 'canceled',
    });
    expect(await ledger(userId)).toHaveLength(0);
  });

  it('settles a forged Status=NOK return when the gateway says the order was paid', async () => {
    const userId = await createUser();
    const gateway = createGateway();
    const { app } = createApp(gateway);
    const { orderId } = await startZarinpal(app, gateway);
    gateway.reply('/pg/v4/payment/verify.json', {
      body: { data: { code: 100, ref_id: 211 }, errors: [] },
    });

    const res = await request(app).get(
      `/api/payments/callback/zarinpal?order=${orderId}&Authority=${AUTHORITY}&Status=NOK`,
    );

    expect(res.headers.location).toContain('status=success');
    expect(await db.findPaymentOrderById(orderId)).toMatchObject({
      status: 'paid',
      credited: true,
    });
    expect(await ledger(userId)).toHaveLength(1);
  });

  it('keeps a Status=NOK order open when the verify is inconclusive', async () => {
    await createUser();
    const gateway = createGateway();
    const { app } = createApp(gateway);
    const { orderId } = await startZarinpal(app, gateway);
    gateway.reply('/pg/v4/payment/verify.json', { status: 502, body: null });

    const res = await request(app).get(
      `/api/payments/callback/zarinpal?order=${orderId}&Authority=${AUTHORITY}&Status=NOK`,
    );

    expect(res.headers.location).toContain('status=pending');
    expect((await db.findPaymentOrderById(orderId))?.status).toBe('pending');
  });

  it('settles a genuine OK return that arrives after a forged NOK canceled the order', async () => {
    const userId = await createUser();
    const gateway = createGateway();
    const { app } = createApp(gateway);
    const { orderId } = await startZarinpal(app, gateway);
    gateway.reply(
      '/pg/v4/payment/verify.json',
      { status: 400, body: { data: [], errors: { code: -51, message: 'failed' } } },
      { body: { data: { code: 100, ref_id: 212 }, errors: [] } },
    );
    const base = `/api/payments/callback/zarinpal?order=${orderId}&Authority=${AUTHORITY}`;
    await request(app).get(`${base}&Status=NOK`);
    expect((await db.findPaymentOrderById(orderId))?.status).toBe('canceled');

    const res = await request(app).get(`${base}&Status=OK`);

    expect(res.headers.location).toContain('status=success');
    expect(await db.findPaymentOrderById(orderId)).toMatchObject({
      status: 'paid',
      credited: true,
    });
    expect(await ledger(userId)).toHaveLength(1);
  });

  it('verifies a forged IDPay cancel (status 7) and settles a paid order', async () => {
    const userId = await createUser();
    const gateway = createGateway();
    const { app } = createApp(gateway);
    gateway.reply('/v1.1/payment', {
      status: 201,
      body: { id: IDPAY_ID, link: `https://idpay.ir/p/ws-sandbox/${IDPAY_ID}` },
    });
    const checkout = await request(app)
      .post('/api/payments/checkout')
      .send({ packId: 'starter', gateway: 'idpay' });
    const orderId = checkout.body.orderId as string;
    gateway.reply('/v1.1/payment/verify', {
      body: { status: 100, track_id: '10013', id: IDPAY_ID, order_id: orderId },
    });

    const res = await request(app)
      .post(`/api/payments/callback/idpay?order=${orderId}`)
      .type('form')
      .send({ status: '7', id: IDPAY_ID, order_id: orderId });

    expect(res.headers.location).toContain('status=success');
    expect(gateway.calls[gateway.calls.length - 1]?.path).toBe('/v1.1/payment/verify');
    expect(await ledger(userId)).toHaveLength(1);
  });

  it('re-verifies a recently canceled order once after expiry and credits a late payment', async () => {
    const userId = await createUser();
    const gateway = createGateway();
    const { app } = createApp(gateway);
    const { orderId } = await startZarinpal(app, gateway);
    gateway.reply('/pg/v4/payment/verify.json', {
      status: 400,
      body: { data: [], errors: { code: -51, message: 'failed' } },
    });
    await request(app).get(
      `/api/payments/callback/zarinpal?order=${orderId}&Authority=${AUTHORITY}&Status=NOK`,
    );
    expect((await db.findPaymentOrderById(orderId))?.status).toBe('canceled');

    /** Not before the order's own expiry: the buyer may still be on the gateway page */
    const early = await request(app).post('/api/payments/admin/reconcile');
    expect(early.body.checked).toBe(0);

    await mongoose.models.PaymentOrder.updateOne(
      { _id: orderId },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    gateway.reply('/pg/v4/payment/verify.json', {
      body: { data: { code: 100, ref_id: 213 }, errors: [] },
    });
    const res = await request(app).post('/api/payments/admin/reconcile');

    expect(res.body).toEqual({ checked: 1, paid: 1, expired: 0, credited: 0, failed: 0 });
    expect(await db.findPaymentOrderById(orderId)).toMatchObject({
      status: 'paid',
      credited: true,
    });
    expect(await ledger(userId)).toHaveLength(1);
  });

  it('re-verifies a canceled order only once, and never one older than the window', async () => {
    await createUser();
    const gateway = createGateway();
    const { app } = createApp(gateway);
    const recent = await startZarinpal(app, gateway);
    gateway.reply('/pg/v4/payment/verify.json', {
      status: 400,
      body: { data: [], errors: { code: -51, message: 'failed' } },
    });
    await request(app).get(
      `/api/payments/callback/zarinpal?order=${recent.orderId}&Authority=${AUTHORITY}&Status=NOK`,
    );
    const old = await mongoose.models.PaymentOrder.create({
      user: currentUser?.id,
      packId: 'starter',
      packLabel: 'Starter',
      credits: 2_000_000,
      amountRial: 5_390_000,
      gateway: 'zarinpal',
      status: 'canceled',
      errorCode: 'canceled',
      authority: 'A000000000000000000000000000217885160',
      expiresAt: new Date(Date.now() - 2 * 86_400_000),
    });
    await mongoose.models.PaymentOrder.collection.updateOne(
      { _id: old._id },
      { $set: { createdAt: new Date(Date.now() - 2 * 86_400_000) } },
    );
    await mongoose.models.PaymentOrder.updateOne(
      { _id: recent.orderId },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    gateway.reply('/pg/v4/payment/verify.json', {
      status: 400,
      body: { data: [], errors: { code: -51, message: 'failed' } },
    });

    const first = await request(app).post('/api/payments/admin/reconcile');
    expect(first.body).toMatchObject({ checked: 1, paid: 0, failed: 0 });
    expect((await db.findPaymentOrderById(recent.orderId))?.status).toBe('canceled');

    const second = await request(app).post('/api/payments/admin/reconcile');
    expect(second.body.checked).toBe(0);
  });

  it('ignores a return whose authority does not match the order', async () => {
    await createUser();
    const gateway = createGateway();
    const { app } = createApp(gateway);
    const { orderId } = await startZarinpal(app, gateway);
    const res = await request(app).get(
      `/api/payments/callback/zarinpal?order=${orderId}&Authority=A999999999999999999999999999999999999&Status=OK`,
    );
    expect(res.headers.location).toContain('code=invalid_callback');
    expect(gateway.calls).toHaveLength(1);
    expect((await db.findPaymentOrderById(orderId))?.status).toBe('pending');
  });

  it('closes the order as failed on an amount mismatch (-50)', async () => {
    const userId = await createUser();
    const gateway = createGateway();
    const { app } = createApp(gateway);
    const { orderId } = await startZarinpal(app, gateway);
    gateway.reply('/pg/v4/payment/verify.json', {
      status: 400,
      body: { data: [], errors: { code: -50, message: 'amount' } },
    });
    const res = await request(app).get(
      `/api/payments/callback/zarinpal?order=${orderId}&Authority=${AUTHORITY}&Status=OK`,
    );
    expect(res.headers.location).toContain('code=amount_mismatch');
    expect(await db.findPaymentOrderById(orderId)).toMatchObject({
      status: 'failed',
      errorCode: 'amount_mismatch',
    });
    expect(await ledger(userId)).toHaveLength(0);
  });

  it('keeps the order open when verification times out', async () => {
    await createUser();
    const gateway = createGateway();
    const { app } = createApp(gateway);
    const { orderId } = await startZarinpal(app, gateway);
    gateway.reply('/pg/v4/payment/verify.json', { status: 502, body: null });
    const res = await request(app).get(
      `/api/payments/callback/zarinpal?order=${orderId}&Authority=${AUTHORITY}&Status=OK`,
    );
    expect(res.headers.location).toContain('status=pending');
    expect((await db.findPaymentOrderById(orderId))?.status).toBe('pending');
  });

  it('settles an IDPay POST callback after verify', async () => {
    const userId = await createUser();
    const gateway = createGateway();
    const { app } = createApp(gateway);
    gateway.reply('/v1.1/payment', {
      status: 201,
      body: { id: IDPAY_ID, link: `https://idpay.ir/p/ws-sandbox/${IDPAY_ID}` },
    });
    const checkout = await request(app)
      .post('/api/payments/checkout')
      .send({ packId: 'starter', gateway: 'idpay' });
    const orderId = checkout.body.orderId as string;
    gateway.reply('/v1.1/payment/verify', {
      body: {
        status: 100,
        track_id: '10012',
        id: IDPAY_ID,
        order_id: orderId,
        amount: '5390000',
        payment: { track_id: '888001', amount: '5390000', card_no: '123456******1234' },
      },
    });

    const res = await request(app)
      .post(`/api/payments/callback/idpay?order=${orderId}`)
      .type('form')
      .send({
        status: '10',
        track_id: '10012',
        id: IDPAY_ID,
        order_id: orderId,
        amount: '5390000',
      });

    expect(res.status).toBe(303);
    expect(res.headers.location).toContain('status=success');
    expect(await ledger(userId)).toHaveLength(1);
  });

  it("hides another user's order", async () => {
    await createUser();
    const gateway = createGateway();
    const { app } = createApp(gateway);
    const { orderId } = await startZarinpal(app, gateway);
    await createUser();
    const res = await request(app).get(`/api/payments/orders/${orderId}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'order_not_found' } });
  });

  it('retries a failed credit from reconciliation without crediting twice', async () => {
    const userId = await createUser();
    const gateway = createGateway();
    /** The ledger write itself fails, so nothing of the credit lands */
    const restore = interceptWrites(({ model }, run) =>
      model === 'Transaction' ? Promise.reject(new Error('database blip')) : run(),
    );
    let clock = Date.now();
    const { app } = createApp(gateway, () => new Date(clock));
    const { orderId } = await startZarinpal(app, gateway);
    gateway.reply('/pg/v4/payment/verify.json', {
      body: { data: { code: 100, ref_id: 301 }, errors: [] },
    });
    const res = await request(app).get(
      `/api/payments/callback/zarinpal?order=${orderId}&Authority=${AUTHORITY}&Status=OK`,
    );
    restore();
    expect(res.headers.location).toContain('code=credit_failed');
    expect(await db.findPaymentOrderById(orderId)).toMatchObject({
      status: 'paid',
      credited: false,
    });
    const own = await request(app).get(`/api/payments/orders/${orderId}`);
    expect(own.body).toMatchObject({ status: 'paid', credited: false });

    /** Inside the 2-minute credit lease nobody else may credit */
    const early = await request(app).post('/api/payments/admin/reconcile');
    expect(early.body.checked).toBe(0);

    clock += 3 * 60_000;
    const retried = await request(app).post('/api/payments/admin/reconcile');
    expect(retried.body).toMatchObject({ checked: 1, credited: 1 });
    expect(await ledger(userId)).toHaveLength(1);

    /** The ledger marker stops a re-credit when only the "credited" flag was lost */
    await mongoose.models.PaymentOrder.updateOne(
      { _id: orderId },
      { $set: { creditedAt: null, creditLeaseUntil: null } },
    );
    const again = await request(app).post('/api/payments/admin/reconcile');
    expect(again.body).toMatchObject({ checked: 1, credited: 1 });
    const entries = await ledger(userId);
    expect(entries).toHaveLength(1);
    expect(entries[0].messageId).toBe(`payment:${orderId}`);
    expect((await db.findBalanceByUser(userId))?.tokenCredits).toBe(2_000_000);
  });

  it('adds the credits once on a retry when the balance update failed after the ledger write', async () => {
    const userId = await createUser();
    const gateway = createGateway();
    const restore = interceptWrites(({ model }, run) =>
      model === 'Balance' ? Promise.reject(new Error('balance write failed')) : run(),
    );
    let clock = Date.now();
    const { app } = createApp(gateway, () => new Date(clock));
    const { orderId } = await startZarinpal(app, gateway);
    gateway.reply('/pg/v4/payment/verify.json', {
      body: { data: { code: 100, ref_id: 305 }, errors: [] },
    });
    const res = await request(app).get(
      `/api/payments/callback/zarinpal?order=${orderId}&Authority=${AUTHORITY}&Status=OK`,
    );
    restore();
    expect(res.headers.location).toContain('code=credit_failed');
    expect(await ledger(userId)).toHaveLength(1);
    expect((await db.findBalanceByUser(userId))?.tokenCredits ?? 0).toBe(0);

    clock += 3 * 60_000;
    const retried = await request(app).post('/api/payments/admin/reconcile');
    expect(retried.body).toMatchObject({ checked: 1, credited: 1 });

    /** A further pass after the "credited" flag is lost adds nothing */
    await mongoose.models.PaymentOrder.updateOne(
      { _id: orderId },
      { $set: { creditedAt: null, creditLeaseUntil: null } },
    );
    await request(app).post('/api/payments/admin/reconcile');

    expect(await creditState(userId, orderId)).toEqual({
      tokenCredits: 2_000_000,
      packId: 'starter',
      packAllotment: 2_000_000,
      ledger: [`payment:${orderId}`],
      credited: true,
      userPack: 'starter',
    });
  }, 30_000);

  it('leaves a single complete credit after a crash at any write of the credit', async () => {
    let clock = Date.now();
    const { handlers } = createApp(createGateway(), () => new Date(clock));
    const credit = async (orderId: string) => {
      const order = await db.findPaymentOrderById(orderId);
      return handlers.service.ensureCredited(order!, settings).catch(() => false);
    };

    /** A clean credit, counting its writes: one crash point after each of them */
    const probeUser = await createUser();
    const probeOrder = await createPaidOrder(probeUser, new Date(clock));
    let writes = 0;
    const stopCounting = interceptWrites((_write, run) => {
      writes += 1;
      return run();
    });
    expect(await credit(probeOrder)).toBe(true);
    stopCounting();
    expect(writes).toBeGreaterThan(2);

    const outcomes = [];
    for (let crashAfter = 1; crashAfter <= writes; crashAfter++) {
      const userId = await createUser();
      const orderId = await createPaidOrder(userId, new Date(clock));
      /** The write lands, then the process "dies": nothing after it in this attempt runs */
      const restore = interceptWrites(async ({ n }, run) => {
        const result = await run();
        if (n === crashAfter) {
          throw new Error(`crash after write ${n}`);
        }
        return result;
      });
      await credit(orderId);
      restore();

      clock += 3 * 60_000;
      await credit(orderId);
      /** A late extra pass (lost "credited" flag) must not add anything either */
      await mongoose.models.PaymentOrder.updateOne(
        { _id: orderId },
        { $set: { creditedAt: null, creditLeaseUntil: null } },
      );
      await credit(orderId);
      outcomes.push({ crashAfter, ...(await creditState(userId, orderId)) });
    }

    expect(outcomes).toEqual(
      outcomes.map(({ crashAfter, ledger: entries }) => ({
        crashAfter,
        tokenCredits: 2_000_000,
        packId: 'starter',
        packAllotment: 2_000_000,
        ledger: [entries[0]],
        credited: true,
        userPack: 'starter',
      })),
    );
    expect(outcomes.every(({ ledger: entries }) => entries[0]?.startsWith('payment:'))).toBe(true);
  }, 60_000);

  it('credits once when two retries of a half-done credit run together', async () => {
    const userId = await createUser();
    await mongoose.models.Balance.create({ user: userId, tokenCredits: 0 });
    let clock = Date.now();
    const { handlers } = createApp(createGateway(), () => new Date(clock));
    const orderId = await createPaidOrder(userId, new Date(clock));
    const credit = async () => {
      const order = await db.findPaymentOrderById(orderId);
      return handlers.service.ensureCredited(order!, settings).catch(() => false);
    };

    /** The first attempt dies right after its ledger write */
    let restore = interceptWrites(async ({ model }, run) => {
      const result = await run();
      if (model === 'Transaction') {
        throw new Error('crash after the ledger write');
      }
      return result;
    });
    expect(await credit()).toBe(false);
    restore();
    expect(await ledger(userId)).toHaveLength(1);

    /** Retry one stalls at its balance write past its lease; retry two takes over and finishes */
    const parked: Array<() => void> = [];
    let balanceWrites = 0;
    restore = interceptWrites(async ({ model }, run) => {
      if (model === 'Balance' && ++balanceWrites === 1) {
        await new Promise<void>((resolve) => parked.push(resolve));
      }
      return run();
    });
    clock += 3 * 60_000;
    const first = credit();
    await waitForParked(parked, 1);
    clock += 3 * 60_000;
    const second = await credit();
    parked.forEach((release) => release());
    const results = [await first, second];
    restore();

    expect(results).toEqual([true, true]);
    expect(await creditState(userId, orderId)).toEqual({
      tokenCredits: 2_000_000,
      packId: 'starter',
      packAllotment: 2_000_000,
      ledger: [`payment:${orderId}`],
      credited: true,
      userPack: 'starter',
    });
  });

  it('does not credit a late retry again after its marker aged out, because its ledger entry is applied', async () => {
    const userId = await createUser();
    let clock = Date.now();
    const { handlers } = createApp(createGateway(), () => new Date(clock));
    const credit = async (orderId: string) => {
      const order = await db.findPaymentOrderById(orderId);
      return handlers.service.ensureCredited(order!, settings);
    };
    const markers = async () =>
      (
        await mongoose.models.Balance.findOne({ user: userId })
          .select('+appliedCredits')
          .lean<{ appliedCredits?: { id: string; settledAt?: Date }[] }>()
      )?.appliedCredits ?? [];

    const first = await createPaidOrder(userId, new Date(clock));
    expect(await credit(first)).toBe(true);
    expect(await markers()).toEqual([
      expect.objectContaining({ id: `payment:${first}`, settledAt: new Date(clock) }),
    ]);

    /** Past the 7-day default retention, the next credit drops the first marker */
    clock += 8 * 24 * 60 * 60_000;
    const second = await createPaidOrder(userId, new Date(clock));
    expect(await credit(second)).toBe(true);
    expect((await markers()).map((marker) => marker.id)).toEqual([`payment:${second}`]);

    /** A late retry of the first order (its "credited" flag lost) reads the applied entry */
    await mongoose.models.PaymentOrder.updateOne(
      { _id: first },
      { $set: { creditedAt: null, creditLeaseUntil: null } },
    );
    expect(await credit(first)).toBe(true);

    expect((await db.findBalanceByUser(userId))?.tokenCredits).toBe(4_000_000);
    expect(await ledger(userId)).toHaveLength(2);
    expect((await markers()).map((marker) => marker.id)).toEqual([`payment:${second}`]);
  });

  it('treats a ledger entry without the applied flag as credited and completes a pending one', async () => {
    const userId = await createUser();
    const clock = Date.now();
    const { app } = createApp(createGateway(), () => new Date(clock));
    const legacyOrder = await createPaidOrder(userId, new Date(clock - 60_000));
    const pendingOrder = await createPaidOrder(userId, new Date(clock - 30_000));
    const entry = (orderId: string) => ({
      user: new mongoose.Types.ObjectId(userId),
      tokenType: 'credits',
      context: 'pack',
      rawAmount: 2_000_000,
      rate: 1,
      tokenValue: 2_000_000,
      messageId: `payment:${orderId}`,
    });
    /** An entry from before the flag, whose credit reached the balance */
    await mongoose.models.Transaction.collection.insertOne(entry(legacyOrder));
    await mongoose.models.Balance.create({ user: userId, tokenCredits: 2_000_000 });
    /** An entry whose credit never reached the balance */
    await mongoose.models.Transaction.collection.insertOne({
      ...entry(pendingOrder),
      applied: false,
    });

    const res = await request(app).post('/api/payments/admin/reconcile');

    expect(res.body).toMatchObject({ checked: 2, credited: 2 });
    expect(await creditState(userId, pendingOrder)).toEqual({
      tokenCredits: 4_000_000,
      packId: 'starter',
      packAllotment: 4_000_000,
      ledger: [`payment:${legacyOrder}`, `payment:${pendingOrder}`],
      credited: true,
      userPack: 'starter',
    });
    expect(await db.findPaymentOrderById(legacyOrder)).toMatchObject({ credited: true });
  });

  it('credits once when a second claim takes over an expired lease mid-grant', async () => {
    const userId = await createUser();
    const gateway = createGateway();
    const parked: Array<() => void> = [];
    /** Every credit stalls inside its ledger write until released */
    const restore = interceptWrites(async ({ model }, run) => {
      if (model === 'Transaction') {
        await new Promise<void>((resolve) => parked.push(resolve));
      }
      return run();
    });
    let clock = Date.now();
    const { app, handlers } = createApp(gateway, () => new Date(clock));
    const { orderId } = await startZarinpal(app, gateway);
    gateway.reply('/pg/v4/payment/verify.json', {
      body: { data: { code: 100, ref_id: 304 }, errors: [] },
    });

    /** The first credit stalls inside the ledger write past its 2-minute lease */
    const first = request(app)
      .get(`/api/payments/callback/zarinpal?order=${orderId}&Authority=${AUTHORITY}&Status=OK`)
      .then((res) => res);
    await waitForParked(parked, 1);
    clock += 3 * 60_000;
    const order = await db.findPaymentOrderById(orderId);
    const second = handlers.service.ensureCredited(order!, settings);
    await waitForParked(parked, 2);
    restore();
    parked.forEach((release) => release());
    await Promise.all([first, second]);

    expect(await ledger(userId)).toHaveLength(1);
    expect((await db.findBalanceByUser(userId))?.tokenCredits).toBe(2_000_000);
    expect(await db.findPaymentOrderById(orderId)).toMatchObject({ credited: true });
  });

  it('copies the pack onto the user on a retry when the credit failed after the balance write', async () => {
    const userId = await createUser();
    const gateway = createGateway();
    const restore = interceptWrites(({ model }, run) =>
      model === 'User' ? Promise.reject(new Error('database blip')) : run(),
    );
    let clock = Date.now();
    const { app } = createApp(gateway, () => new Date(clock));
    const { orderId } = await startZarinpal(app, gateway);
    gateway.reply('/pg/v4/payment/verify.json', {
      body: { data: { code: 100, ref_id: 302 }, errors: [] },
    });
    const res = await request(app).get(
      `/api/payments/callback/zarinpal?order=${orderId}&Authority=${AUTHORITY}&Status=OK`,
    );
    restore();
    expect(res.headers.location).toContain('code=credit_failed');
    expect((await mongoose.models.User.findById(userId).lean<{ packId?: string }>())?.packId).toBe(
      undefined,
    );

    clock += 3 * 60_000;
    const retried = await request(app).post('/api/payments/admin/reconcile');

    expect(retried.body).toMatchObject({ checked: 1, credited: 1 });
    expect(await creditState(userId, orderId)).toEqual({
      tokenCredits: 2_000_000,
      packId: 'starter',
      packAllotment: 2_000_000,
      ledger: [`payment:${orderId}`],
      credited: true,
      userPack: 'starter',
    });
  });

  it('does not roll back a newer pack when a late retry finds the ledger entry', async () => {
    const userId = await createUser();
    const gateway = createGateway();
    let clock = Date.now();
    const { app } = createApp(gateway, () => new Date(clock));
    const { orderId } = await startZarinpal(app, gateway);
    gateway.reply('/pg/v4/payment/verify.json', {
      body: { data: { code: 100, ref_id: 303 }, errors: [] },
    });
    await request(app).get(
      `/api/payments/callback/zarinpal?order=${orderId}&Authority=${AUTHORITY}&Status=OK`,
    );
    clock += 60_000;
    await db.upsertBalanceFields(userId, {
      packId: 'pro',
      packLabel: 'Pro',
      packAllotment: 15_000_000,
      packGrantedAt: new Date(clock),
    });
    await db.updateUser(userId, { packId: 'pro' }, {}, { preserveExpiresAt: true });
    await mongoose.models.PaymentOrder.updateOne(
      { _id: orderId },
      { $set: { creditedAt: null, creditLeaseUntil: null } },
    );

    const again = await request(app).post('/api/payments/admin/reconcile');

    expect(again.body).toMatchObject({ checked: 1, credited: 1 });
    expect(await db.findBalanceByUser(userId)).toMatchObject({ packId: 'pro' });
    expect((await mongoose.models.User.findById(userId).lean<{ packId?: string }>())?.packId).toBe(
      'pro',
    );
  });

  it('reconciles a stale pending order that was paid but never returned', async () => {
    const userId = await createUser();
    const gateway = createGateway();
    const { app } = createApp(gateway);
    const { orderId } = await startZarinpal(app, gateway);
    await mongoose.models.PaymentOrder.updateOne(
      { _id: orderId },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    gateway.reply('/pg/v4/payment/verify.json', {
      body: { data: { code: 100, ref_id: 401 }, errors: [] },
    });

    const res = await request(app).post('/api/payments/admin/reconcile');

    expect(res.body).toEqual({ checked: 1, paid: 1, expired: 0, credited: 0, failed: 0 });
    expect(await ledger(userId)).toHaveLength(1);
  });

  it('expires a stale unpaid order and leaves a fresh one open', async () => {
    await createUser();
    const gateway = createGateway();
    const { app } = createApp(gateway);
    const stale = await startZarinpal(app, gateway);
    await mongoose.models.PaymentOrder.updateOne(
      { _id: stale.orderId },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    gateway.reply('/pg/v4/payment/verify.json', {
      status: 400,
      body: { data: [], errors: { code: -51, message: 'failed' } },
    });

    const res = await request(app).post('/api/payments/admin/reconcile');

    expect(res.body).toMatchObject({ checked: 1, expired: 1 });
    expect((await db.findPaymentOrderById(stale.orderId))?.status).toBe('expired');
  });

  it('lists orders for admins with filters and sums paid ones', async () => {
    const userId = await createUser();
    const gateway = createGateway();
    const { app } = createApp(gateway);
    const { orderId } = await startZarinpal(app, gateway);
    gateway.reply('/pg/v4/payment/verify.json', {
      body: { data: { code: 100, ref_id: 501, card_pan: '502229******5995' }, errors: [] },
    });
    await request(app).get(
      `/api/payments/callback/zarinpal?order=${orderId}&Authority=${AUTHORITY}&Status=OK`,
    );

    const list = await request(app).get('/api/payments/admin/orders?status=paid&gateway=zarinpal');
    expect(list.body.total).toBe(1);
    expect(list.body.orders[0]).toMatchObject({
      id: orderId,
      status: 'paid',
      referenceId: '501',
      cardPan: '502229******5995',
      user: { id: userId },
    });
    expect(list.body.orders[0].user.email).toContain('@example.com');
    const byRef = await request(app).get('/api/payments/admin/orders?search=501');
    expect(byRef.body.total).toBe(1);
    const none = await request(app).get('/api/payments/admin/orders?status=failed');
    expect(none.body.total).toBe(0);

    const summary = await request(app).get('/api/payments/admin/summary');
    expect(summary.body.today).toEqual({ count: 1, amountRial: 5_390_000, credits: 2_000_000 });
    expect(summary.body.month.count).toBe(1);

    const status = await request(app).get('/api/payments/admin/status');
    expect(status.body.gateways[0]).toMatchObject({
      id: 'zarinpal',
      enabled: true,
      configured: true,
      sandbox: true,
      usable: true,
      healthy: true,
    });
    expect(JSON.stringify(status.body)).not.toContain(MERCHANT);
  });
});
