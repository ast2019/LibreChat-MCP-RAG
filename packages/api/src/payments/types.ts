import type { TPaymentGateway } from 'librechat-data-provider';

/**
 * The design follows shetabit/multipay (`Invoice` → `Driver::purchase/pay/verify` → `Receipt`):
 * a driver turns an invoice into a gateway transaction and a redirect, then verifies the
 * buyer's return into a receipt. `pay()`'s redirect form collapses into `redirectUrl`, and the
 * callback parsing that multipay does through `Request::input` is an explicit `parseCallback`.
 */
export interface PaymentInvoice {
  /** Our order id; sent to the gateway as its order/reference number */
  orderId: string;
  /** Always rials; a driver converts when its API takes tomans */
  amountRial: number;
  callbackUrl: string;
  description: string;
}

export interface PurchaseResult {
  /** Zarinpal `authority`, IDPay `id` */
  transactionId: string;
  /** Where the browser goes to pay */
  redirectUrl: string;
}

/** What the buyer's return says, before any server-to-server verification. */
export interface CallbackOutcome {
  status: 'ok' | 'canceled' | 'failed';
  transactionId?: string;
  /** The order id the gateway echoed back, when it echoes one */
  orderId?: string;
  /** The gateway's raw status, for logs */
  gatewayStatus?: string;
}

export interface VerifyRequest {
  transactionId: string;
  orderId: string;
  /** The order's amount, never one read from the callback */
  amountRial: number;
}

export interface PaymentReceipt {
  driver: TPaymentGateway;
  /** Zarinpal `ref_id`, IDPay `track_id` */
  referenceId: string;
  transactionId: string;
  /** The amount the gateway reports as paid, when its verify response carries one */
  amountRial?: number;
  /** Masked card number */
  cardPan?: string;
  /** The gateway had already verified this transaction (Zarinpal 101, IDPay 101) */
  alreadyVerified: boolean;
}

export interface PaymentDriver {
  readonly name: TPaymentGateway;
  readonly sandbox: boolean;
  purchase(invoice: PaymentInvoice): Promise<PurchaseResult>;
  parseCallback(params: Record<string, unknown>): CallbackOutcome;
  verify(request: VerifyRequest): Promise<PaymentReceipt>;
}

/** HTTP and timing a driver receives from its caller. */
export interface DriverContext {
  fetch: typeof fetch;
  timeoutMs: number;
}

export interface ZarinpalConfig {
  merchantId: string;
  sandbox: boolean;
  /** Unit sent in `amount`; orders stay in rials */
  currency: 'IRR' | 'IRT';
}

export interface IdpayConfig {
  apiKey: string;
  sandbox: boolean;
}

/** Credentials per gateway. Adding a driver adds its key here and its factory to the registry. */
export interface GatewayConfigs {
  zarinpal: ZarinpalConfig;
  idpay: IdpayConfig;
}
