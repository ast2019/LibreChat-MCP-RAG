import { isPaymentGateway } from 'librechat-data-provider';
import { logger, paymentLedgerMarker } from '@librechat/data-schemas';
import type {
  TBalancePack,
  TPaymentOptions,
  TPaymentErrorCode,
  TPaymentCheckoutResponse,
  TAdminPaymentsReconcileResponse,
} from 'librechat-data-provider';
import type {
  PaymentSettlement,
  PaymentOrderRecord,
  PaymentOrderCreateData,
} from '@librechat/data-schemas';
import type { ResolvedCurrency } from '~/billing/currency';
import type { PaymentDriverRegistry } from './registry';
import type { GrantBalanceDeps } from '~/billing/packs';
import type { PaymentSettings } from './config';
import type { GatewayHealth } from './health';
import type { PaymentDriver } from './types';
import { FINAL_DRIVER_CODES, isPaymentDriverError } from './errors';
import { grantBalance } from '~/billing/packs';
import { getUsableGateways } from './config';
import { packPriceRial } from './pricing';

/** The data-schemas payment methods the service needs. */
export interface PaymentStore {
  createPaymentOrder: (data: PaymentOrderCreateData) => Promise<PaymentOrderRecord>;
  setPaymentOrderAuthority: (
    orderId: string,
    authority: string,
  ) => Promise<PaymentOrderRecord | null>;
  findPaymentOrderById: (orderId: string) => Promise<PaymentOrderRecord | null>;
  settlePaymentOrder: (
    orderId: string,
    settlement: PaymentSettlement,
  ) => Promise<PaymentOrderRecord | null>;
  closePaymentOrder: (
    orderId: string,
    status: 'failed' | 'canceled' | 'expired',
    errorCode?: TPaymentErrorCode,
  ) => Promise<PaymentOrderRecord | null>;
  claimPaymentOrderCredit: (orderId: string, now: Date, leaseUntil: Date) => Promise<boolean>;
  markPaymentOrderCredited: (orderId: string, at: Date) => Promise<void>;
  hasPaymentLedgerEntry: (userId: string, orderId: string) => Promise<boolean>;
  listPaymentOrdersToReconcile: (params: {
    now: Date;
    limit?: number;
  }) => Promise<PaymentOrderRecord[]>;
}

export interface PaymentServiceDeps {
  store: PaymentStore;
  /** The admin grant path (ledger transaction + pack allotment); the transaction also carries
   *  the order's ledger marker so a retry can tell it already landed. */
  grant: {
    createTransaction: (
      tx: Parameters<GrantBalanceDeps['createTransaction']>[0] & { messageId: string },
    ) => ReturnType<GrantBalanceDeps['createTransaction']>;
    upsertBalanceFields: GrantBalanceDeps['upsertBalanceFields'];
  };
  registry: PaymentDriverRegistry;
  health?: GatewayHealth;
  now?: () => Date;
  /** How long one caller may hold the right to credit a paid order */
  creditLeaseMs?: number;
}

export type PaymentFailure = { code: TPaymentErrorCode; status: number };
export type PaymentResult<T> = { ok: true; value: T } | { ok: false; error: PaymentFailure };

/** Where a callback or check left the order. `pending` means "not decided yet, keep it open". */
export interface PaymentOutcome {
  status: 'success' | 'failed' | 'pending';
  orderId?: string;
  code?: TPaymentErrorCode;
}

const DEFAULT_CREDIT_LEASE_MS = 2 * 60_000;
const DEFAULT_DESCRIPTION = 'خرید بستهٔ {pack}';

const fail = (code: TPaymentErrorCode, status: number): { ok: false; error: PaymentFailure } => ({
  ok: false,
  error: { code, status },
});

/** `getBalanceConfig()` output; packs merge in unvalidated, so each is checked before use. */
type BalanceLike = { enabled?: boolean; packs?: Partial<TBalancePack>[] } | null | undefined;

type ValidPack = TBalancePack;

function validPacks(balance: BalanceLike): ValidPack[] {
  return (balance?.packs ?? []).filter(
    (pack): pack is ValidPack =>
      typeof pack?.id === 'string' &&
      typeof pack.label === 'string' &&
      typeof pack.credits === 'number' &&
      Number.isInteger(pack.credits) &&
      pack.credits > 0,
  );
}

/** Packs priced by the server, and the gateways a buyer can choose. */
export function getPaymentOptions(
  settings: PaymentSettings,
  balance: BalanceLike,
  currency: ResolvedCurrency | undefined,
): TPaymentOptions {
  const gateways = getUsableGateways(settings).map(({ id, sandbox }) => ({ id, sandbox }));
  if (gateways.length === 0 || balance?.enabled !== true) {
    return { enabled: false, gateways: [], packs: [] };
  }
  const packs = validPacks(balance).flatMap((pack) => {
    const amountRial = packPriceRial(pack.credits, currency);
    return amountRial == null
      ? []
      : [
          {
            id: pack.id,
            label: pack.label,
            ...(pack.description != null && { description: pack.description }),
            credits: pack.credits,
            amountRial,
          },
        ];
  });
  return { enabled: true, gateways, packs };
}

/** Checkout, callback verification and reconciliation (see {@link createPaymentService}). */
export interface PaymentService {
  checkout: (input: {
    settings: PaymentSettings;
    balance: BalanceLike;
    currency: ResolvedCurrency | undefined;
    userId: string;
    packId: unknown;
    gateway: unknown;
  }) => Promise<PaymentResult<TPaymentCheckoutResponse>>;
  completeCallback: (input: {
    settings: PaymentSettings;
    gateway: string;
    order: PaymentOrderRecord | null;
    params: Record<string, unknown>;
  }) => Promise<PaymentOutcome>;
  checkOrder: (order: PaymentOrderRecord, settings: PaymentSettings) => Promise<PaymentOutcome>;
  reconcile: (input: {
    resolveSettings: (order: PaymentOrderRecord) => Promise<PaymentSettings>;
    limit?: number;
  }) => Promise<TAdminPaymentsReconcileResponse>;
  ensureCredited: (order: PaymentOrderRecord) => Promise<boolean>;
}

export function createPaymentService(deps: PaymentServiceDeps): PaymentService {
  const now = deps.now ?? (() => new Date());
  const leaseMs = deps.creditLeaseMs ?? DEFAULT_CREDIT_LEASE_MS;
  const { store } = deps;

  const recordFailure = (driver: PaymentDriver, code: string) =>
    deps.health?.recordFailure(driver.name, code);
  const recordSuccess = (driver: PaymentDriver) => deps.health?.recordSuccess(driver.name);

  /**
   * Starts a purchase. The amount comes from the server's pack list and live rate, never from
   * the request; the order exists before the gateway is called so its id is the gateway's
   * order number and the callback's state.
   */
  async function checkout(input: {
    settings: PaymentSettings;
    balance: BalanceLike;
    currency: ResolvedCurrency | undefined;
    userId: string;
    packId: unknown;
    gateway: unknown;
  }): Promise<PaymentResult<TPaymentCheckoutResponse>> {
    const { settings, balance } = input;
    if (!settings.enabled) {
      return fail('payments_disabled', 409);
    }
    if (balance?.enabled !== true) {
      return fail('balance_disabled', 409);
    }
    if (!isPaymentGateway(input.gateway)) {
      return fail('gateway_unavailable', 400);
    }
    const driver = deps.registry.get(input.gateway, settings);
    if (driver == null || settings.callbackBaseUrl == null) {
      return fail('gateway_unavailable', 409);
    }
    const pack =
      typeof input.packId === 'string'
        ? validPacks(balance).find((candidate) => candidate.id === input.packId)
        : undefined;
    if (pack == null) {
      return fail('pack_not_found', 404);
    }
    const amountRial = packPriceRial(pack.credits, input.currency);
    if (amountRial == null) {
      return fail('price_unavailable', 409);
    }

    const created = now();
    const order = await store.createPaymentOrder({
      user: input.userId,
      packId: pack.id,
      packLabel: pack.label,
      credits: pack.credits,
      amountRial,
      gateway: driver.name,
      expiresAt: new Date(created.getTime() + settings.orderTtlMinutes * 60_000),
    });
    const callbackUrl =
      `${settings.callbackBaseUrl}/api/payments/callback/${driver.name}` +
      `?order=${encodeURIComponent(order.id)}`;
    const description = (settings.description ?? DEFAULT_DESCRIPTION).replace('{pack}', pack.label);

    let purchase;
    try {
      purchase = await driver.purchase({ orderId: order.id, amountRial, callbackUrl, description });
    } catch (error) {
      if (!isPaymentDriverError(error)) {
        await store.closePaymentOrder(order.id, 'failed', 'purchase_failed');
        throw error;
      }
      recordFailure(driver, error.code);
      await store.closePaymentOrder(order.id, 'failed', error.code);
      logger.warn(
        `[payments] ${driver.name} purchase failed for order ${order.id}: ${error.code}` +
          (error.gatewayStatus ? ` (${error.gatewayStatus})` : ''),
      );
      return fail(
        error.code === 'gateway_unreachable' ? 'gateway_unreachable' : 'purchase_failed',
        502,
      );
    }
    recordSuccess(driver);
    const stored = await store.setPaymentOrderAuthority(order.id, purchase.transactionId);
    if (stored == null) {
      throw new Error(`payment order ${order.id} could not store its authority`);
    }
    logger.info(`[payments] order ${order.id} started on ${driver.name} (${amountRial} IRR)`);
    return {
      ok: true,
      value: { orderId: order.id, redirectUrl: purchase.redirectUrl, amountRial },
    };
  }

  /** Grants a paid order's credits once. The caller holds the order's credit lease. */
  async function credit(order: PaymentOrderRecord): Promise<boolean> {
    try {
      if (!(await store.hasPaymentLedgerEntry(order.userId, order.id))) {
        await grantBalance(
          {
            createTransaction: (tx) =>
              deps.grant.createTransaction({ ...tx, messageId: paymentLedgerMarker(order.id) }),
            upsertBalanceFields: deps.grant.upsertBalanceFields,
            now,
          },
          {
            userId: order.userId,
            credits: order.credits,
            pack: { id: order.packId, label: order.packLabel, credits: order.credits },
          },
        );
      }
      await store.markPaymentOrderCredited(order.id, now());
      logger.info(`[payments] order ${order.id} credited ${order.credits} credits`);
      return true;
    } catch (error) {
      logger.error(`[payments] crediting order ${order.id} failed; reconciliation retries it`, {
        error: error instanceof Error ? error.message : 'unknown',
      });
      return false;
    }
  }

  /** Credits a paid order unless someone else holds its lease or it is already credited. */
  async function ensureCredited(order: PaymentOrderRecord): Promise<boolean> {
    if (order.credited) {
      return true;
    }
    const at = now();
    const claimed = await store.claimPaymentOrderCredit(
      order.id,
      at,
      new Date(at.getTime() + leaseMs),
    );
    return claimed ? credit(order) : false;
  }

  function outcomeOf(order: PaymentOrderRecord, credited = order.credited): PaymentOutcome {
    if (order.status === 'paid') {
      return credited
        ? { status: 'success', orderId: order.id }
        : { status: 'pending', orderId: order.id, code: 'credit_failed' };
    }
    if (order.status === 'pending') {
      return { status: 'pending', orderId: order.id };
    }
    return {
      status: 'failed',
      orderId: order.id,
      code: order.errorCode ?? (order.status === 'expired' ? 'order_expired' : 'verify_failed'),
    };
  }

  /**
   * Verifies with the gateway (amount from the order) and settles exactly once. `callback`
   * closes a definitive non-payment as failed; `check` (reconciliation/admin) leaves an
   * unexpired unpaid order open and expires it once past `expiresAt`.
   */
  async function verifyAndSettle(
    order: PaymentOrderRecord,
    driver: PaymentDriver,
    mode: 'callback' | 'check',
  ): Promise<PaymentOutcome> {
    if (order.authority == null) {
      if (mode === 'check' && order.expiresAt.getTime() <= now().getTime()) {
        const closed = await store.closePaymentOrder(order.id, 'expired', 'order_expired');
        return closed ? outcomeOf(closed) : refresh(order.id);
      }
      return { status: 'pending', orderId: order.id };
    }
    let receipt;
    try {
      receipt = await driver.verify({
        transactionId: order.authority,
        orderId: order.id,
        amountRial: order.amountRial,
      });
    } catch (error) {
      if (!isPaymentDriverError(error)) {
        throw error;
      }
      const gatewayStatus = error.gatewayStatus ? ` (${error.gatewayStatus})` : '';
      if (!FINAL_DRIVER_CODES.has(error.code)) {
        recordFailure(driver, error.code);
        logger.warn(
          `[payments] verify of order ${order.id} inconclusive: ${error.code}${gatewayStatus}`,
        );
        return { status: 'pending', orderId: order.id, code: error.code };
      }
      recordSuccess(driver);
      const unpaid = error.code === 'not_paid' || error.code === 'canceled';
      if (mode === 'check' && unpaid && order.expiresAt.getTime() > now().getTime()) {
        return { status: 'pending', orderId: order.id };
      }
      const status = mode === 'check' && unpaid ? 'expired' : 'failed';
      if (error.code === 'amount_mismatch') {
        logger.error(`[payments] order ${order.id} amount mismatch at ${driver.name}; review it`);
      } else {
        logger.info(`[payments] order ${order.id} not paid: ${error.code}${gatewayStatus}`);
      }
      const closed = await store.closePaymentOrder(order.id, status, error.code);
      return closed ? outcomeOf(closed) : refresh(order.id);
    }
    recordSuccess(driver);

    if (receipt.amountRial != null && receipt.amountRial !== order.amountRial) {
      logger.error(`[payments] order ${order.id} amount mismatch at ${driver.name}; review it`);
      const closed = await store.closePaymentOrder(order.id, 'failed', 'amount_mismatch');
      return closed ? outcomeOf(closed) : refresh(order.id);
    }

    const paidAt = now();
    const settled = await store.settlePaymentOrder(order.id, {
      referenceId: receipt.referenceId,
      ...(receipt.cardPan != null && { cardPan: receipt.cardPan }),
      paidAt,
      leaseUntil: new Date(paidAt.getTime() + leaseMs),
    });
    if (settled == null) {
      /** Another callback won the settle, or the reference already belongs to another order */
      const current = await store.findPaymentOrderById(order.id);
      if (current?.status === 'paid') {
        return outcomeOf(current, await ensureCredited(current));
      }
      logger.error(`[payments] order ${order.id} verified but could not be settled`);
      return { status: 'failed', orderId: order.id, code: 'verify_failed' };
    }
    logger.info(
      `[payments] order ${order.id} paid on ${driver.name}` +
        (receipt.alreadyVerified ? ' (already verified)' : ''),
    );
    return outcomeOf(settled, await credit(settled));
  }

  async function refresh(orderId: string): Promise<PaymentOutcome> {
    const current = await store.findPaymentOrderById(orderId);
    return current ? outcomeOf(current) : { status: 'failed', code: 'order_not_found' };
  }

  /**
   * Handles the buyer's return. The order must belong to this gateway and the returned
   * transaction id must equal the one stored at checkout — that pair is the callback's state,
   * so a forged or replayed return can at most trigger a harmless re-verification.
   */
  async function completeCallback(input: {
    settings: PaymentSettings;
    gateway: string;
    order: PaymentOrderRecord | null;
    params: Record<string, unknown>;
  }): Promise<PaymentOutcome> {
    const { order } = input;
    if (order == null || !isPaymentGateway(input.gateway) || order.gateway !== input.gateway) {
      return { status: 'failed', code: 'invalid_callback' };
    }
    const driver = deps.registry.get(order.gateway, input.settings);
    if (driver == null) {
      return { status: 'pending', orderId: order.id, code: 'gateway_unavailable' };
    }
    const returned = driver.parseCallback(input.params);
    if (
      order.authority == null ||
      returned.transactionId !== order.authority ||
      (returned.orderId != null && returned.orderId !== order.id)
    ) {
      logger.warn(`[payments] callback for order ${order.id} did not match its transaction`);
      return { status: 'failed', orderId: order.id, code: 'invalid_callback' };
    }
    if (order.status === 'paid') {
      return outcomeOf(order, await ensureCredited(order));
    }
    if (order.status === 'failed' || order.status === 'canceled') {
      return outcomeOf(order);
    }
    if (returned.status !== 'ok') {
      const canceled = returned.status === 'canceled';
      const closed = await store.closePaymentOrder(
        order.id,
        canceled ? 'canceled' : 'failed',
        canceled ? 'canceled' : 'not_paid',
      );
      logger.info(`[payments] order ${order.id} returned ${returned.status} from ${driver.name}`);
      return closed ? outcomeOf(closed) : refresh(order.id);
    }
    return verifyAndSettle(order, driver, 'callback');
  }

  /** Admin "check again" for one order. */
  async function checkOrder(
    order: PaymentOrderRecord,
    settings: PaymentSettings,
  ): Promise<PaymentOutcome> {
    if (order.status === 'paid') {
      return outcomeOf(order, await ensureCredited(order));
    }
    if (order.status !== 'pending' && order.status !== 'expired') {
      return outcomeOf(order);
    }
    const driver = deps.registry.get(order.gateway, settings);
    if (driver == null) {
      return { status: 'pending', orderId: order.id, code: 'gateway_unavailable' };
    }
    return verifyAndSettle(order, driver, 'check');
  }

  /**
   * Re-verifies pending orders past their expiry and credits paid orders whose credit never
   * landed. Orders run one after another so a backlog does not burst the gateway.
   */
  async function reconcile({
    resolveSettings,
    limit,
  }: {
    resolveSettings: (order: PaymentOrderRecord) => Promise<PaymentSettings>;
    limit?: number;
  }): Promise<TAdminPaymentsReconcileResponse> {
    const orders = await store.listPaymentOrdersToReconcile({ now: now(), limit });
    const summary = { checked: orders.length, paid: 0, expired: 0, credited: 0, failed: 0 };
    for (const order of orders) {
      try {
        if (order.status === 'paid') {
          summary.credited += (await ensureCredited(order)) ? 1 : 0;
          continue;
        }
        const outcome = await checkOrder(order, await resolveSettings(order));
        if (outcome.status === 'success') {
          summary.paid += 1;
        } else if (outcome.status === 'failed') {
          summary[
            outcome.code === 'not_paid' ||
            outcome.code === 'canceled' ||
            outcome.code === 'order_expired'
              ? 'expired'
              : 'failed'
          ] += 1;
        }
      } catch (error) {
        summary.failed += 1;
        logger.error(`[payments] reconciling order ${order.id} failed`, {
          error: error instanceof Error ? error.message : 'unknown',
        });
      }
    }
    return summary;
  }

  return { checkout, completeCallback, checkOrder, reconcile, ensureCredited };
}
