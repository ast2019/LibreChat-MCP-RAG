import type { TPaymentErrorCode } from 'librechat-data-provider';

/** Failures a driver reports; mirrors multipay's PurchaseFailed/InvalidPayment/Timeout exceptions. */
export type PaymentDriverErrorCode = Extract<
  TPaymentErrorCode,
  | 'purchase_failed'
  | 'gateway_unreachable'
  | 'not_paid'
  | 'canceled'
  | 'amount_mismatch'
  | 'verify_failed'
  | 'invalid_callback'
>;

/**
 * A gateway call that did not succeed. `code` is safe to show (mapped to copy by the UI);
 * `gatewayStatus` is the gateway's own code, for logs only — never its message text.
 */
export class PaymentDriverError extends Error {
  readonly code: PaymentDriverErrorCode;
  readonly gatewayStatus?: string;

  constructor(code: PaymentDriverErrorCode, message: string, gatewayStatus?: string | number) {
    super(message);
    this.name = 'PaymentDriverError';
    this.code = code;
    if (gatewayStatus != null) {
      this.gatewayStatus = String(gatewayStatus);
    }
  }
}

export const isPaymentDriverError = (error: unknown): error is PaymentDriverError =>
  error instanceof PaymentDriverError;

/**
 * Codes after which the order can never be paid. Anything else (an outage, an unknown gateway
 * code) leaves it open, because the buyer may already have paid and reconciliation will see it.
 */
export const FINAL_DRIVER_CODES: ReadonlySet<PaymentDriverErrorCode> = new Set([
  'not_paid',
  'canceled',
  'amount_mismatch',
  'invalid_callback',
]);
