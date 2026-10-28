import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createModels, createMethods } from '@librechat/data-schemas';
import type { AppConfig, IUser } from '@librechat/data-schemas';
import type { CurrencyRates } from '~/billing/currency';
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

function createApp(
  gateway: ReturnType<typeof createGateway>,
  grantOverride?: Partial<typeof db>,
  now?: () => Date,
) {
  const handlers = createPaymentHandlers({
    now,
    getAppConfig: async () => appConfig,
    getTenantAppConfig: async () => appConfig,
    currencyRates,
    store: db,
    grant: {
      createTransaction: grantOverride?.createTransaction ?? db.createTransaction,
      upsertBalanceFields: db.upsertBalanceFields,
    },
    fetch: gateway.fetchImpl,
    env: {
      DOMAIN_SERVER: 'https://hive.example',
      DOMAIN_CLIENT: 'https://hive.example',
      ZARINPAL_MERCHANT_ID: MERCHANT,
      IDPAY_API_KEY: 'idpay-key',
    },
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

  it('marks a Status=NOK return as canceled without verifying or crediting', async () => {
    const userId = await createUser();
    const gateway = createGateway();
    const { app } = createApp(gateway);
    const { orderId } = await startZarinpal(app, gateway);

    const res = await request(app).get(
      `/api/payments/callback/zarinpal?order=${orderId}&Authority=${AUTHORITY}&Status=NOK`,
    );

    expect(res.headers.location).toContain('status=failed');
    expect(res.headers.location).toContain('code=canceled');
    expect(gateway.calls).toHaveLength(1);
    expect((await db.findPaymentOrderById(orderId))?.status).toBe('canceled');
    expect(await ledger(userId)).toHaveLength(0);
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
    let failGrant = true;
    const createTransaction: typeof db.createTransaction = async (tx) => {
      if (failGrant) {
        throw new Error('database blip');
      }
      return db.createTransaction(tx);
    };
    let clock = Date.now();
    const { app } = createApp(gateway, { createTransaction }, () => new Date(clock));
    const { orderId } = await startZarinpal(app, gateway);
    gateway.reply('/pg/v4/payment/verify.json', {
      body: { data: { code: 100, ref_id: 301 }, errors: [] },
    });
    const res = await request(app).get(
      `/api/payments/callback/zarinpal?order=${orderId}&Authority=${AUTHORITY}&Status=OK`,
    );
    expect(res.headers.location).toContain('code=credit_failed');
    expect(await db.findPaymentOrderById(orderId)).toMatchObject({
      status: 'paid',
      credited: false,
    });
    const own = await request(app).get(`/api/payments/orders/${orderId}`);
    expect(own.body).toMatchObject({ status: 'paid', credited: false });

    failGrant = false;
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
