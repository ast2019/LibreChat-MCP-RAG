import { createIdpayDriver } from './idpay';

const ID = 'd2e353189823079e1e4181772cff5292';
const ORDER = '65f000000000000000000001';

type Call = { url: string; body: Record<string, unknown>; headers: Record<string, string> };

function mockFetch(responses: { status?: number; body: unknown }[]) {
  const calls: Call[] = [];
  const fetchImpl = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? '{}')),
      headers: init?.headers as Record<string, string>,
    });
    const next = responses.shift() ?? { status: 500, body: null };
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const make = (responses: { status?: number; body: unknown }[], sandbox = false) => {
  const mock = mockFetch(responses);
  return {
    ...mock,
    driver: createIdpayDriver(
      { apiKey: 'key-1', sandbox },
      { fetch: mock.fetchImpl, timeoutMs: 1000 },
    ),
  };
};

const invoice = {
  orderId: ORDER,
  amountRial: 5_390_000,
  callbackUrl: `https://hive.example/api/payments/callback/idpay?order=${ORDER}`,
  description: 'خرید بستهٔ Starter',
};

describe('IdpayDriver', () => {
  it('creates a payment with the API key and sandbox headers', async () => {
    const { driver, calls } = make(
      [{ status: 201, body: { id: ID, link: `https://idpay.ir/p/ws-sandbox/${ID}` } }],
      true,
    );

    const result = await driver.purchase(invoice);

    expect(calls[0].url).toBe('https://api.idpay.ir/v1.1/payment');
    expect(calls[0].headers).toMatchObject({ 'X-API-KEY': 'key-1', 'X-SANDBOX': '1' });
    expect(calls[0].body).toEqual({
      order_id: ORDER,
      amount: 5_390_000,
      desc: invoice.description,
      callback: invoice.callbackUrl,
    });
    expect(result).toEqual({
      transactionId: ID,
      redirectUrl: `https://idpay.ir/p/ws-sandbox/${ID}`,
    });
  });

  it('refuses a link outside idpay.ir', async () => {
    const { driver } = make([{ status: 201, body: { id: ID, link: 'https://evil.example/pay' } }]);
    await expect(driver.purchase(invoice)).rejects.toMatchObject({ code: 'purchase_failed' });
  });

  it('reports the error_code of a refused request', async () => {
    const { driver } = make([
      { status: 406, body: { error_code: 34, error_message: 'amount too low' } },
    ]);
    await expect(driver.purchase(invoice)).rejects.toMatchObject({
      code: 'purchase_failed',
      gatewayStatus: '34',
    });
  });

  describe('callback', () => {
    const { driver } = make([]);
    it('reads status 10 as paid-to-verify', () => {
      expect(
        driver.parseCallback({ status: '10', id: ID, order_id: ORDER, track_id: '1' }),
      ).toEqual({
        status: 'ok',
        transactionId: ID,
        orderId: ORDER,
        gatewayStatus: '10',
      });
    });
    it('reads status 7 as canceled and other codes as failed', () => {
      expect(driver.parseCallback({ status: '7', id: ID, order_id: ORDER }).status).toBe(
        'canceled',
      );
      expect(driver.parseCallback({ status: '2', id: ID, order_id: ORDER }).status).toBe('failed');
    });
    it('accepts numeric POST fields', () => {
      expect(driver.parseCallback({ status: 10, id: ID, order_id: ORDER }).status).toBe('ok');
    });
  });

  describe('verify', () => {
    const request = { transactionId: ID, orderId: ORDER, amountRial: 5_390_000 };
    const verified = (status: number, amount = 5_390_000) => ({
      status,
      track_id: '10012',
      id: ID,
      order_id: ORDER,
      amount: String(amount),
      payment: { track_id: '888001', amount: String(amount), card_no: '123456******1234' },
      verify: { date: 1546288500 },
    });

    it('returns a receipt on status 100', async () => {
      const { driver, calls } = make([{ body: verified(100) }]);
      const receipt = await driver.verify(request);
      expect(calls[0].url).toBe('https://api.idpay.ir/v1.1/payment/verify');
      expect(calls[0].body).toEqual({ id: ID, order_id: ORDER });
      expect(receipt).toEqual({
        driver: 'idpay',
        referenceId: '10012',
        transactionId: ID,
        amountRial: 5_390_000,
        cardPan: '123456******1234',
        alreadyVerified: false,
      });
    });

    it('treats 101 as already verified', async () => {
      const { driver } = make([{ body: verified(101) }]);
      await expect(driver.verify(request)).resolves.toMatchObject({ alreadyVerified: true });
    });

    it('rejects a verified amount that differs from the order', async () => {
      const { driver } = make([{ body: verified(100, 10_000) }]);
      await expect(driver.verify(request)).rejects.toMatchObject({ code: 'amount_mismatch' });
    });

    it.each([53, 54])('maps error_code %s to not_paid', async (code) => {
      const { driver } = make([{ status: 400, body: { error_code: code, error_message: 'x' } }]);
      await expect(driver.verify(request)).rejects.toMatchObject({ code: 'not_paid' });
    });

    it('maps an unknown failure to verify_failed', async () => {
      const { driver } = make([{ status: 500, body: null }]);
      await expect(driver.verify(request)).rejects.toMatchObject({ code: 'verify_failed' });
    });
  });
});
