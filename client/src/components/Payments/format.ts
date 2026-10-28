import { isPaymentErrorCode } from 'librechat-data-provider';
import type {
  TPaymentGateway,
  TPaymentErrorCode,
  TPaymentOrderStatus,
} from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks/useLocalize';
import { formatCost } from '~/utils';

/** An amount in rials as the UI shows prices: tomans, Persian digits. */
export function formatRial(amountRial: number): string {
  return formatCost(amountRial / 10, { code: 'IRT', rate: 1 });
}

export const GATEWAY_LABELS: Record<TPaymentGateway, TranslationKeys> = {
  zarinpal: 'com_ui_payment_gateway_zarinpal',
  idpay: 'com_ui_payment_gateway_idpay',
};

export const ERROR_LABELS: Record<TPaymentErrorCode, TranslationKeys> = {
  payments_disabled: 'com_ui_payment_error_payments_disabled',
  balance_disabled: 'com_ui_payment_error_balance_disabled',
  gateway_unavailable: 'com_ui_payment_error_gateway_unavailable',
  pack_not_found: 'com_ui_payment_error_pack_not_found',
  price_unavailable: 'com_ui_payment_error_price_unavailable',
  purchase_failed: 'com_ui_payment_error_purchase_failed',
  gateway_unreachable: 'com_ui_payment_error_gateway_unreachable',
  canceled: 'com_ui_payment_error_canceled',
  not_paid: 'com_ui_payment_error_not_paid',
  amount_mismatch: 'com_ui_payment_error_amount_mismatch',
  verify_failed: 'com_ui_payment_error_verify_failed',
  invalid_callback: 'com_ui_payment_error_invalid_callback',
  order_not_found: 'com_ui_payment_error_order_not_found',
  order_expired: 'com_ui_payment_error_order_expired',
  credit_failed: 'com_ui_payment_error_credit_failed',
  rate_limited: 'com_ui_payment_error_rate_limited',
};

export const STATUS_LABELS: Record<TPaymentOrderStatus, TranslationKeys> = {
  pending: 'com_admin_payments_status_pending',
  paid: 'com_admin_payments_status_paid',
  failed: 'com_admin_payments_status_failed',
  canceled: 'com_admin_payments_status_canceled',
  expired: 'com_admin_payments_status_expired',
};

/** The localized message key for a payment error code; unknown codes get the fallback. */
export function errorLabel(code: unknown): TranslationKeys {
  return isPaymentErrorCode(code) ? ERROR_LABELS[code] : 'com_ui_payment_error_unknown';
}

/** The stable code a payment API error carries (`{ error: { code } }`), if any. */
export function readErrorCode(error: unknown): TPaymentErrorCode | undefined {
  const code = (error as { response?: { data?: { error?: { code?: unknown } } } } | null)?.response
    ?.data?.error?.code;
  return isPaymentErrorCode(code) ? code : undefined;
}

const dateFormatter = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' });

export function formatDate(value?: string): string {
  if (value == null) {
    return '—';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateFormatter.format(date);
}
