import type {
  VerifyRequest,
  DriverContext,
  PaymentDriver,
  PaymentInvoice,
  PaymentReceipt,
  PurchaseResult,
  CallbackOutcome,
  ZarinpalConfig,
} from '../types';
import { asRecord, postJson, readParam, readString } from '../http';
import { PaymentDriverError } from '../errors';

/** REST v4 hosts, as in Zarinpal's official Node SDK (`payment.` live, `sandbox.` for tests). */
export const ZARINPAL_HOSTS = {
  live: 'https://payment.zarinpal.com',
  sandbox: 'https://sandbox.zarinpal.com',
} as const;

const REQUEST_PATH = '/pg/v4/payment/request.json';
const VERIFY_PATH = '/pg/v4/payment/verify.json';
const START_PAY_PATH = '/pg/StartPay/';

/** `data.code` values: 100 paid/verified now, 101 verified before. */
const PAID = 100;
const ALREADY_VERIFIED = 101;
/** `errors.code` values that settle the verify outcome; anything else may be transient. */
const AMOUNT_MISMATCH = -50;
const PAYMENT_FAILED = -51;
const FOREIGN_AUTHORITY = -53;
const INVALID_AUTHORITY = -54;

/** An authority is `A`/`S` + 35 alphanumerics; the looser check only keeps the URL safe. */
const AUTHORITY_PATTERN = /^[A-Za-z0-9]{8,64}$/;

/** Zarinpal answers `{ data: {...}, errors: [] }` on success and `{ data: [], errors: {...} }` on failure. */
function readEnvelope(body: unknown): { data?: Record<string, unknown>; errorCode?: number } {
  const root = asRecord(body);
  const data = asRecord(root?.data);
  const errors = asRecord(root?.errors);
  const errorCode = typeof errors?.code === 'number' ? errors.code : undefined;
  return { data, errorCode };
}

function toGatewayAmount(amountRial: number, currency: ZarinpalConfig['currency']): number {
  return currency === 'IRT' ? Math.round(amountRial / 10) : amountRial;
}

/**
 * Zarinpal Payment Gateway REST v4. Mirrors multipay's `Zarinpal` driver with its
 * `Normal`/`Sandbox` strategies (the SOAP `Zaringate` strategy has no v4 counterpart here).
 */
export function createZarinpalDriver(config: ZarinpalConfig, ctx: DriverContext): PaymentDriver {
  const host = config.sandbox ? ZARINPAL_HOSTS.sandbox : ZARINPAL_HOSTS.live;

  async function purchase(invoice: PaymentInvoice): Promise<PurchaseResult> {
    const { status, body } = await postJson(ctx, `${host}${REQUEST_PATH}`, {
      merchant_id: config.merchantId,
      amount: toGatewayAmount(invoice.amountRial, config.currency),
      currency: config.currency,
      callback_url: invoice.callbackUrl,
      description: invoice.description,
      metadata: { order_id: invoice.orderId },
    });
    const { data, errorCode } = readEnvelope(body);
    const authority = readString(data?.authority);
    if (data?.code !== PAID || authority == null || !AUTHORITY_PATTERN.test(authority)) {
      throw new PaymentDriverError(
        'purchase_failed',
        'zarinpal payment request was refused',
        errorCode ?? (typeof data?.code === 'number' ? data.code : `http_${status}`),
      );
    }
    return {
      transactionId: authority,
      redirectUrl: `${host}${START_PAY_PATH}${encodeURIComponent(authority)}`,
    };
  }

  /** The return carries `Authority` and `Status=OK|NOK`; NOK is a failed or canceled payment. */
  function parseCallback(params: Record<string, unknown>): CallbackOutcome {
    const transactionId = readParam(params, 'Authority');
    const gatewayStatus = readParam(params, 'Status');
    if (transactionId == null || !AUTHORITY_PATTERN.test(transactionId)) {
      return { status: 'failed', gatewayStatus };
    }
    return {
      status: gatewayStatus === 'OK' ? 'ok' : 'canceled',
      transactionId,
      gatewayStatus,
    };
  }

  async function verify(request: VerifyRequest): Promise<PaymentReceipt> {
    const { status, body } = await postJson(ctx, `${host}${VERIFY_PATH}`, {
      merchant_id: config.merchantId,
      authority: request.transactionId,
      amount: toGatewayAmount(request.amountRial, config.currency),
    });
    const { data, errorCode } = readEnvelope(body);
    const code = typeof data?.code === 'number' ? data.code : undefined;
    const referenceId = readString(data?.ref_id);
    if ((code === PAID || code === ALREADY_VERIFIED) && referenceId != null) {
      return {
        driver: 'zarinpal',
        referenceId,
        transactionId: request.transactionId,
        ...(readString(data?.card_pan) && { cardPan: readString(data?.card_pan) }),
        alreadyVerified: code === ALREADY_VERIFIED,
      };
    }
    const gatewayStatus = errorCode ?? code ?? `http_${status}`;
    if (errorCode === AMOUNT_MISMATCH) {
      throw new PaymentDriverError('amount_mismatch', 'zarinpal amount mismatch', gatewayStatus);
    }
    if (errorCode === PAYMENT_FAILED) {
      throw new PaymentDriverError('not_paid', 'zarinpal payment not completed', gatewayStatus);
    }
    if (errorCode === FOREIGN_AUTHORITY || errorCode === INVALID_AUTHORITY) {
      throw new PaymentDriverError(
        'invalid_callback',
        'zarinpal authority rejected',
        gatewayStatus,
      );
    }
    throw new PaymentDriverError('verify_failed', 'zarinpal verify failed', gatewayStatus);
  }

  return { name: 'zarinpal', sandbox: config.sandbox, purchase, parseCallback, verify };
}
