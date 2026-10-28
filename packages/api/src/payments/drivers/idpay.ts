import type {
  IdpayConfig,
  VerifyRequest,
  DriverContext,
  PaymentDriver,
  PaymentInvoice,
  PaymentReceipt,
  PurchaseResult,
  CallbackOutcome,
} from '../types';
import { asRecord, postJson, readNumber, readParam, readString } from '../http';
import { PaymentDriverError } from '../errors';

export const IDPAY_API = 'https://api.idpay.ir/v1.1';

/** Callback `status`: 10 = paid, awaiting our verify; 7 = canceled by the buyer. */
const AWAITING_VERIFY = 10;
const CANCELED = 7;
/** Verify `status`: 100 verified now, 101 verified before, 200 settled to the merchant. */
const VERIFIED = 100;
const ALREADY_VERIFIED = 101;
const SETTLED = 200;
/** Verify `error_code`s meaning the payment cannot be verified (52 no result, 53 not
 *  verifiable, 54 verify window passed). */
const NOT_PAYABLE_ERRORS = new Set([52, 53, 54]);

const TRANSACTION_PATTERN = /^[A-Za-z0-9]{8,64}$/;

/** Only follow IDPay's own payment pages, never an arbitrary `link`. */
function isIdpayLink(link: string): boolean {
  try {
    const url = new URL(link);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'idpay.ir' || url.hostname.endsWith('.idpay.ir'))
    );
  } catch {
    return false;
  }
}

/** IDPay web service v1.1. Mirrors multipay's `Idpay` driver (removed upstream in 2025). */
export function createIdpayDriver(config: IdpayConfig, ctx: DriverContext): PaymentDriver {
  const headers = { 'X-API-KEY': config.apiKey, 'X-SANDBOX': config.sandbox ? '1' : '0' };

  async function purchase(invoice: PaymentInvoice): Promise<PurchaseResult> {
    const { status, body } = await postJson(
      ctx,
      `${IDPAY_API}/payment`,
      {
        order_id: invoice.orderId,
        amount: invoice.amountRial,
        desc: invoice.description,
        callback: invoice.callbackUrl,
      },
      headers,
    );
    const result = asRecord(body);
    const id = readString(result?.id);
    const link = readString(result?.link);
    if (
      status !== 201 ||
      id == null ||
      !TRANSACTION_PATTERN.test(id) ||
      link == null ||
      !isIdpayLink(link)
    ) {
      throw new PaymentDriverError(
        'purchase_failed',
        'idpay payment request was refused',
        readString(result?.error_code) ?? `http_${status}`,
      );
    }
    return { transactionId: id, redirectUrl: link };
  }

  /** IDPay returns `status, track_id, id, order_id, amount, card_no, hashed_card_no, date`
   *  by POST (default) or GET. */
  function parseCallback(params: Record<string, unknown>): CallbackOutcome {
    const transactionId = readParam(params, 'id');
    const orderId = readParam(params, 'order_id');
    const gatewayStatus = readParam(params, 'status');
    const code = readNumber(gatewayStatus);
    if (transactionId == null || !TRANSACTION_PATTERN.test(transactionId)) {
      return { status: 'failed', gatewayStatus };
    }
    const base = { transactionId, ...(orderId != null && { orderId }), gatewayStatus };
    if (
      code === AWAITING_VERIFY ||
      code === VERIFIED ||
      code === ALREADY_VERIFIED ||
      code === SETTLED
    ) {
      return { status: 'ok', ...base };
    }
    return { status: code === CANCELED ? 'canceled' : 'failed', ...base };
  }

  async function verify(request: VerifyRequest): Promise<PaymentReceipt> {
    const { status, body } = await postJson(
      ctx,
      `${IDPAY_API}/payment/verify`,
      { id: request.transactionId, order_id: request.orderId },
      headers,
    );
    const result = asRecord(body);
    const code = readNumber(result?.status);
    const errorCode = readNumber(result?.error_code);
    const payment = asRecord(result?.payment);
    const referenceId = readString(result?.track_id) ?? readString(payment?.track_id);
    if (
      status === 200 &&
      (code === VERIFIED || code === ALREADY_VERIFIED || code === SETTLED) &&
      referenceId != null
    ) {
      const amountRial = readNumber(result?.amount) ?? readNumber(payment?.amount);
      if (
        readString(result?.order_id) != null &&
        readString(result?.order_id) !== request.orderId
      ) {
        throw new PaymentDriverError('invalid_callback', 'idpay order mismatch', code);
      }
      if (amountRial != null && amountRial !== request.amountRial) {
        throw new PaymentDriverError('amount_mismatch', 'idpay amount mismatch', code);
      }
      const cardPan = readString(payment?.card_no);
      return {
        driver: 'idpay',
        referenceId,
        transactionId: request.transactionId,
        ...(amountRial != null && { amountRial }),
        ...(cardPan != null && { cardPan }),
        alreadyVerified: code !== VERIFIED,
      };
    }
    const gatewayStatus = errorCode ?? code ?? `http_${status}`;
    if (
      (errorCode != null && NOT_PAYABLE_ERRORS.has(errorCode)) ||
      (code != null && code < VERIFIED)
    ) {
      throw new PaymentDriverError('not_paid', 'idpay payment not verifiable', gatewayStatus);
    }
    throw new PaymentDriverError('verify_failed', 'idpay verify failed', gatewayStatus);
  }

  return { name: 'idpay', sandbox: config.sandbox, purchase, parseCallback, verify };
}
