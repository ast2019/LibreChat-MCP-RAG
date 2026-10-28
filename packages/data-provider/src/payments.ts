import { z } from 'zod';

/** Payment gateways the server has a driver for. */
export const PAYMENT_GATEWAYS = ['zarinpal', 'idpay'] as const;
export type TPaymentGateway = (typeof PAYMENT_GATEWAYS)[number];

export const isPaymentGateway = (value: unknown): value is TPaymentGateway =>
  typeof value === 'string' && (PAYMENT_GATEWAYS as readonly string[]).includes(value);

export const PAYMENT_ORDER_STATUSES = ['pending', 'paid', 'failed', 'canceled', 'expired'] as const;
export type TPaymentOrderStatus = (typeof PAYMENT_ORDER_STATUSES)[number];

export const DEFAULT_PAYMENT_ORDER_TTL_MINUTES = 30;
export const DEFAULT_PAYMENT_REQUEST_TIMEOUT_MS = 15_000;

const httpUrlSchema = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), 'must be an http(s) URL');

/** Zarinpal REST v4. `currency` is the unit sent to the gateway; order amounts are kept in rials. */
export const zarinpalGatewaySchema = z.object({
  enabled: z.boolean().default(false),
  /** 36-character merchant code; use `${ZARINPAL_MERCHANT_ID}` to read it from the environment. */
  merchantId: z.string().optional(),
  sandbox: z.boolean().default(false),
  currency: z.enum(['IRR', 'IRT']).default('IRR'),
});

/** IDPay v1.1. Amounts are always rials. */
export const idpayGatewaySchema = z.object({
  enabled: z.boolean().default(false),
  /** Web-service API key; use `${IDPAY_API_KEY}` to read it from the environment. */
  apiKey: z.string().optional(),
  sandbox: z.boolean().default(false),
});

/** In-app pack purchase through Iranian payment gateways. Off unless `enabled: true`. */
export const paymentsConfigSchema = z.object({
  enabled: z.boolean().default(false),
  /** Public origin the gateway sends the buyer back to; defaults to `DOMAIN_SERVER`. */
  callbackBaseUrl: httpUrlSchema.optional(),
  /** Minutes an unpaid order stays open before reconciliation may expire it. */
  orderTtlMinutes: z.number().int().min(5).max(1440).default(DEFAULT_PAYMENT_ORDER_TTL_MINUTES),
  /** Timeout for one gateway HTTP call. */
  requestTimeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(60_000)
    .default(DEFAULT_PAYMENT_REQUEST_TIMEOUT_MS),
  /** Text the gateway shows the buyer; `{pack}` is replaced with the pack label. */
  description: z.string().min(1).max(200).optional(),
  gateways: z
    .object({
      zarinpal: zarinpalGatewaySchema.optional(),
      idpay: idpayGatewaySchema.optional(),
    })
    .default({}),
});

export type TPaymentsConfig = z.infer<typeof paymentsConfigSchema>;

/** What `/api/config` tells the client: whether in-app purchase replaces `balance.purchaseUrl`. */
export type TPaymentsStartupConfig = {
  enabled: boolean;
  gateways: TPaymentGateway[];
};

/** Stable codes the payment API returns; the UI maps each to localized copy. */
export const PAYMENT_ERROR_CODES = [
  'payments_disabled',
  'balance_disabled',
  'gateway_unavailable',
  'pack_not_found',
  'price_unavailable',
  'purchase_failed',
  'gateway_unreachable',
  'canceled',
  'not_paid',
  'amount_mismatch',
  'verify_failed',
  'invalid_callback',
  'order_not_found',
  'order_expired',
  'credit_failed',
  'rate_limited',
] as const;
export type TPaymentErrorCode = (typeof PAYMENT_ERROR_CODES)[number];

export const isPaymentErrorCode = (value: unknown): value is TPaymentErrorCode =>
  typeof value === 'string' && (PAYMENT_ERROR_CODES as readonly string[]).includes(value);

/** A pack as the purchase page offers it, priced by the server. */
export type TPaymentPack = {
  id: string;
  label: string;
  description?: string;
  credits: number;
  /** What the gateway charges, in rials */
  amountRial: number;
};

export type TPaymentOptions = {
  enabled: boolean;
  gateways: { id: TPaymentGateway; sandbox: boolean }[];
  packs: TPaymentPack[];
};

export type TPaymentCheckoutRequest = { packId: string; gateway: TPaymentGateway };

export type TPaymentCheckoutResponse = {
  orderId: string;
  redirectUrl: string;
  amountRial: number;
};

/** An order as its owner sees it on the result page. */
export type TPaymentOrder = {
  id: string;
  packId: string;
  packLabel: string;
  credits: number;
  amountRial: number;
  gateway: TPaymentGateway;
  status: TPaymentOrderStatus;
  referenceId?: string;
  errorCode?: TPaymentErrorCode;
  /** The credits reached the balance; a paid order can briefly be uncredited */
  credited: boolean;
  createdAt: string;
  paidAt?: string;
};

export type TAdminPaymentOrder = TPaymentOrder & {
  user: { id: string; email?: string; name?: string };
  /** Masked card number as the gateway reported it */
  cardPan?: string;
  authority?: string;
  expiresAt?: string;
};

export type TAdminPaymentsParams = {
  status?: TPaymentOrderStatus;
  gateway?: TPaymentGateway;
  /** Email, user id, reference id or authority */
  search?: string;
  limit?: number;
  offset?: number;
};

export type TAdminPaymentsResponse = {
  total: number;
  limit: number;
  offset: number;
  orders: TAdminPaymentOrder[];
};

export type TPaymentTotals = { count: number; amountRial: number; credits: number };

export type TAdminPaymentsSummary = {
  /** Start of the day and of the Persian calendar month, Tehran time */
  todaySince: string;
  monthSince: string;
  today: TPaymentTotals;
  month: TPaymentTotals;
  pending: number;
};

export type TAdminPaymentVerifyResponse = { order: TAdminPaymentOrder };

export type TAdminPaymentsReconcileResponse = {
  checked: number;
  paid: number;
  expired: number;
  credited: number;
  failed: number;
};
