import { createZarinpalDriver, ZARINPAL_HOSTS } from './zarinpal';
import { PaymentDriverError } from '../errors';

const AUTHORITY = 'A000000000000000000000000000217885159';
const MERCHANT = '1344b5d4-0048-11e8-94db-005056a205be';

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

const invoice = {
  orderId: '65f000000000000000000001',
  amountRial: 5_390_000,
  callbackUrl: 'https://hive.example/api/payments/callback/zarinpal?order=65f000000000000000000001',
  description: 'خرید بستهٔ Starter',
};

describe('ZarinpalDriver', () => {
  it('requests a payment in rials and redirects to StartPay', async () => {
    const { fetchImpl, calls } = mockFetch([
      { body: { data: { code: 100, message: 'Success', authority: AUTHORITY }, errors: [] } },
    ]);
    const driver = createZarinpalDriver(
      { merchantId: MERCHANT, sandbox: false, currency: 'IRR' },
      { fetch: fetchImpl, timeoutMs: 1000 },
    );

    const result = await driver.purchase(invoice);

    expect(calls[0].url).toBe(`${ZARINPAL_HOSTS.live}/pg/v4/payment/request.json`);
    expect(calls[0].body).toEqual({
      merchant_id: MERCHANT,
      amount: 5_390_000,
      currency: 'IRR',
      callback_url: invoice.callbackUrl,
      description: invoice.description,
      metadata: { order_id: invoice.orderId },
    });
    expect(result).toEqual({
      transactionId: AUTHORITY,
      redirectUrl: `https://payment.zarinpal.com/pg/StartPay/${AUTHORITY}`,
    });
  });

  it('uses the sandbox host and sends tomans with IRT', async () => {
    const { fetchImpl, calls } = mockFetch([
      { body: { data: { code: 100, authority: AUTHORITY }, errors: [] } },
      { body: { data: { code: 100, ref_id: 201, card_pan: '502229******5995' }, errors: [] } },
    ]);
    const driver = createZarinpalDriver(
      { merchantId: MERCHANT, sandbox: true, currency: 'IRT' },
      { fetch: fetchImpl, timeoutMs: 1000 },
    );
    const result = await driver.purchase(invoice);
    await driver.verify({
      transactionId: AUTHORITY,
      orderId: invoice.orderId,
      amountRial: 5_390_000,
    });

    expect(result.redirectUrl).toBe(`https://sandbox.zarinpal.com/pg/StartPay/${AUTHORITY}`);
    expect(calls[0].body).toMatchObject({ amount: 539_000, currency: 'IRT' });
    expect(calls[1].url).toBe('https://sandbox.zarinpal.com/pg/v4/payment/verify.json');
    expect(calls[1].body).toEqual({ merchant_id: MERCHANT, authority: AUTHORITY, amount: 539_000 });
  });

  it('throws purchase_failed with the gateway code when the request is refused', async () => {
    const { fetchImpl } = mockFetch([
      {
        status: 400,
        body: { data: [], errors: { code: -9, message: 'validation', validations: [] } },
      },
    ]);
    const driver = createZarinpalDriver(
      { merchantId: MERCHANT, sandbox: false, currency: 'IRR' },
      { fetch: fetchImpl, timeoutMs: 1000 },
    );
    await expect(driver.purchase(invoice)).rejects.toMatchObject({
      code: 'purchase_failed',
      gatewayStatus: '-9',
    });
  });

  it('maps a network failure to gateway_unreachable', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const driver = createZarinpalDriver(
      { merchantId: MERCHANT, sandbox: false, currency: 'IRR' },
      { fetch: fetchImpl, timeoutMs: 1000 },
    );
    await expect(driver.purchase(invoice)).rejects.toBeInstanceOf(PaymentDriverError);
    await expect(driver.purchase(invoice)).rejects.toMatchObject({ code: 'gateway_unreachable' });
  });

  describe('callback', () => {
    const driver = createZarinpalDriver(
      { merchantId: MERCHANT, sandbox: false, currency: 'IRR' },
      { fetch: jest.fn() as unknown as typeof fetch, timeoutMs: 1000 },
    );
    it('reads Status=OK as paid-to-verify', () => {
      expect(driver.parseCallback({ Authority: AUTHORITY, Status: 'OK' })).toEqual({
        status: 'ok',
        transactionId: AUTHORITY,
        gatewayStatus: 'OK',
      });
    });
    it('reads Status=NOK as a canceled payment', () => {
      expect(driver.parseCallback({ Authority: AUTHORITY, Status: 'NOK' }).status).toBe('canceled');
    });
    it('rejects a missing or malformed authority', () => {
      expect(driver.parseCallback({ Status: 'OK' }).status).toBe('failed');
      expect(driver.parseCallback({ Authority: '../x', Status: 'OK' }).status).toBe('failed');
    });
  });

  describe('verify', () => {
    const request = { transactionId: AUTHORITY, orderId: invoice.orderId, amountRial: 5_390_000 };
    const make = (body: unknown, status = 200) =>
      createZarinpalDriver(
        { merchantId: MERCHANT, sandbox: false, currency: 'IRR' },
        { fetch: mockFetch([{ status, body }]).fetchImpl, timeoutMs: 1000 },
      );

    it('returns a receipt on code 100', async () => {
      const receipt = await make({
        data: { code: 100, ref_id: 201, card_pan: '502229******5995', fee: 0 },
        errors: [],
      }).verify(request);
      expect(receipt).toEqual({
        driver: 'zarinpal',
        referenceId: '201',
        transactionId: AUTHORITY,
        cardPan: '502229******5995',
        alreadyVerified: false,
      });
    });

    it('treats code 101 as an already-verified success', async () => {
      const receipt = await make({ data: { code: 101, ref_id: 201 }, errors: [] }).verify(request);
      expect(receipt).toMatchObject({ referenceId: '201', alreadyVerified: true });
    });

    it.each([
      [-51, 'not_paid'],
      [-50, 'amount_mismatch'],
      [-54, 'invalid_callback'],
      [-53, 'invalid_callback'],
      [-52, 'verify_failed'],
      [-10, 'verify_failed'],
    ])('maps errors.code %s to %s', async (code, expected) => {
      await expect(
        make({ data: [], errors: { code, message: 'x' } }, 400).verify(request),
      ).rejects.toMatchObject({ code: expected, gatewayStatus: String(code) });
    });

    it('does not trust a 100 without a ref_id', async () => {
      await expect(make({ data: { code: 100 }, errors: [] }).verify(request)).rejects.toMatchObject(
        {
          code: 'verify_failed',
        },
      );
    });
  });
});
