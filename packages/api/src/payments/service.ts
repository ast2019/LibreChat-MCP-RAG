import { logger, paymentLedgerMarker } from '@librechat/data-schemas';
import { isPaymentGateway, PAYMENT_REVERIFIABLE_CODES } from 'librechat-data-provider';
import type {
  TBalancePack,
  TPaymentOptions,
  TPaymentErrorCode,
  TPaymentCheckoutResponse,
  TAdminPaymentsReconcileResponse,
} from 'librechat-data-provider';
import type {
  BalanceCreditSettlement,
  PaymentSettlement,
  BalanceCreditGrant,
  PaymentOrderRecord,
  PaymentLedgerState,
  PaymentOrderCreateData,
} from '@librechat/data-schemas';
import type { GrantBalanceDeps, RepairPackGrantDeps } from '~/billing/packs';
import type { ResolvedCurrency } from '~/billing/currency';
import type { PaymentDriverRegistry } from './registry';
import type { PaymentSettings } from './config';
import type { GatewayHealth } from './health';
import type { PaymentDriver } from './types';
import { FINAL_DRIVER_CODES, isPaymentDriverError } from './errors';
import { repairPackGrant } from '~/billing/packs';
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
  recordPaymentLedgerEntry: (entry: {
    userId: string;
    orderId: string;
    credits: number;
  }) => Promise<PaymentLedgerState>;
  markPaymentLedgerApplied: (userId: string, orderId: string) => Promise<void>;
  /** Adds a credit to the balance at most once per `creditId` (see data-schemas). */
  applyBalanceCredit: (grant: BalanceCreditGrant) => Promise<boolean>;
  /** Lets the credit's marker age out once the ledger entry is applied (see data-schemas). */
  settleBalanceCredit: (settlement: BalanceCreditSettlement) => Promise<void>;
  listPaymentOrdersToReconcile: (params: {
    now: Date;
    limit?: number;
    reverifyClosedSince?: Date;
  }) => Promise<PaymentOrderRecord[]>;
  markPaymentOrderReverified: (orderId: string, at: Date) => Promise<void>;
}

export interface PaymentServiceDeps {
  store: PaymentStore;
  /** Finishes the pack side of a credit: the balance's pack fields for a ledger entry that
   *  predates `applied`, and the pack copied onto the user. */
  grant: {
    upsertBalanceFields: GrantBalanceDeps['upsertBalanceFields'];
    setUserPack?: GrantBalanceDeps['setUserPack'];
    findBalance: RepairPackGrantDeps['findBalance'];
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

/** How an unpaid verify closes the order: a callback's own cancel keeps its status and code. */
type UnpaidClose = { status: 'failed' | 'canceled'; code: TPaymentErrorCode };

const isClosed = (order: PaymentOrderRecord): boolean =>
  order.status === 'failed' || order.status === 'canceled';

/** A closed order that only says "not paid" and can still be verified against the gateway. */
const isReverifiable = (order: PaymentOrderRecord): boolean =>
  isClosed(order) &&
  order.authority != null &&
  order.errorCode != null &&
  PAYMENT_REVERIFIABLE_CODES.includes(order.errorCode);

const fail = (code: TPaymentErrorCode, status: number): { ok: false; error: PaymentFailure } => ({
  ok: false,
  error: { code, status },
});

/** `getBalanceConfig()` output; packs merge in unvalidated, so each is checked before use. */
export type BalanceLike = { enabled?: boolean; packs?: Partial<TBalancePack>[] } | null | undefined;

/** Credit packs only — time packs are granted by admins, not sold through the payment gateways. */
export type SellablePack = TBalancePack & { credits: number };

/** The packs checkout sells: credit packs with an id, a label and a positive whole credit count. */
export function sellablePacks(balance: BalanceLike): SellablePack[] {
  return (balance?.packs ?? []).filter(
    (pack): pack is SellablePack =>
      typeof pack?.id === 'string' &&
      typeof pack.label === 'string' &&
      (pack.kind == null || pack.kind === 'credits') &&
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
  const packs = sellablePacks(balance).flatMap((pack) => {
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
    /** Re-verify canceled/failed orders created within this many minutes; 0 or unset skips them */
    reverifyClosedMinutes?: number;
  }) => Promise<TAdminPaymentsReconcileResponse>;
  /** Credits a paid order with the credit-marker policy of `settings` (its tenant's). */
  ensureCredited: (order: PaymentOrderRecord, settings: PaymentSettings) => Promise<boolean>;
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
        ? sellablePacks(balance).find((candidate) => candidate.id === input.packId)
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

  /**
   * Adds a paid order's credits to the balance exactly once and sets its pack, resumable after
   * a failure at any step. The caller holds the order's credit lease.
   *
   * 1. The ledger entry is written `pending`, or found when a previous attempt wrote it; either
   *    way its current state is read in this write, immediately before step 2.
   * 2. Only a pending entry is applied: the balance takes the credits and the pack fields in one
   *    write fenced on the order's marker, so a retry or a stale lease holder cannot add them
   *    again. An entry already applied, or written before the flag existed, skips steps 2-3.
   * 3. The entry is marked applied.
   * 4. The balance marker is settled (also when step 1 found the entry applied, finishing an
   *    earlier attempt), which starts its retention. A settled marker is dropped after
   *    `creditMarkers.retentionMs`; a caller that read the entry as pending before step 3 and
   *    reaches step 2 later than that is the only one it no longer stops, and the lease bounds
   *    such callers far below the retention's 1-hour floor.
   * 5. The pack is copied onto the user (and, for an old entry, the pack fields are finished).
   * 6. The order is marked credited.
   */
  async function credit(order: PaymentOrderRecord, settings: PaymentSettings): Promise<boolean> {
    const pack = { id: order.packId, label: order.packLabel };
    const grantedAfter = order.paidAt ?? order.createdAt;
    try {
      const state = await store.recordPaymentLedgerEntry({
        userId: order.userId,
        orderId: order.id,
        credits: order.credits,
      });
      const creditId = paymentLedgerMarker(order.id);
      if (state === 'pending') {
        const added = await store.applyBalanceCredit({
          user: order.userId,
          creditId,
          credits: order.credits,
          pack,
          grantedAfter,
          at: now(),
          markers: settings.creditMarkers,
        });
        if (!added) {
          logger.info(`[payments] order ${order.id} credits were already on the balance`);
        }
        await store.markPaymentLedgerApplied(order.userId, order.id);
      }
      if (state === 'pending' || state === 'applied') {
        await store.settleBalanceCredit({ user: order.userId, creditId, at: now() });
      } else {
        logger.warn(
          `[payments] order ${order.id} has a ledger entry from before credits were tracked as ` +
            'applied; it is treated as credited, so confirm the balance if the order was retried',
        );
      }
      await repairPackGrant(
        {
          findBalance: deps.grant.findBalance,
          upsertBalanceFields: deps.grant.upsertBalanceFields,
          setUserPack: deps.grant.setUserPack,
          now,
        },
        { userId: order.userId, pack, grantedAfter },
      );
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
  async function ensureCredited(
    order: PaymentOrderRecord,
    settings: PaymentSettings,
  ): Promise<boolean> {
    if (order.credited) {
      return true;
    }
    const at = now();
    const claimed = await store.claimPaymentOrderCredit(
      order.id,
      at,
      new Date(at.getTime() + leaseMs),
    );
    return claimed ? credit(order, settings) : false;
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
   * closes a definitive non-payment as failed (or as `unpaidClose` says); `check`
   * (reconciliation/admin) leaves an unexpired unpaid order open and expires it once past
   * `expiresAt`. A closed order that is verified again stays as it is unless the gateway
   * reports it paid.
   */
  async function verifyAndSettle(
    order: PaymentOrderRecord,
    driver: PaymentDriver,
    settings: PaymentSettings,
    mode: 'callback' | 'check',
    unpaidClose?: UnpaidClose,
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
      if (error.code === 'amount_mismatch') {
        logger.error(`[payments] order ${order.id} amount mismatch at ${driver.name}; review it`);
      } else {
        logger.info(`[payments] order ${order.id} not paid: ${error.code}${gatewayStatus}`);
      }
      if (isClosed(order)) {
        if (mode === 'check') {
          await store.markPaymentOrderReverified(order.id, now());
        }
        return outcomeOf(order);
      }
      if (mode === 'check' && unpaid && order.expiresAt.getTime() > now().getTime()) {
        return { status: 'pending', orderId: order.id };
      }
      let close: UnpaidClose | { status: 'expired'; code: TPaymentErrorCode } = {
        status: 'failed',
        code: error.code,
      };
      if (mode === 'check' && unpaid) {
        close = { status: 'expired', code: error.code };
      } else if (unpaid && unpaidClose) {
        close = unpaidClose;
      }
      const closed = await store.closePaymentOrder(order.id, close.status, close.code);
      return closed ? outcomeOf(closed) : refresh(order.id);
    }
    recordSuccess(driver);

    if (receipt.amountRial != null && receipt.amountRial !== order.amountRial) {
      logger.error(`[payments] order ${order.id} amount mismatch at ${driver.name}; review it`);
      if (isClosed(order)) {
        if (mode === 'check') {
          await store.markPaymentOrderReverified(order.id, now());
        }
        return outcomeOf(order);
      }
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
        return outcomeOf(current, await ensureCredited(current, settings));
      }
      logger.error(`[payments] order ${order.id} verified but could not be settled`);
      return { status: 'failed', orderId: order.id, code: 'verify_failed' };
    }
    logger.info(
      `[payments] order ${order.id} paid on ${driver.name}` +
        (receipt.alreadyVerified ? ' (already verified)' : ''),
    );
    return outcomeOf(settled, await credit(settled, settings));
  }

  async function refresh(orderId: string): Promise<PaymentOutcome> {
    const current = await store.findPaymentOrderById(orderId);
    return current ? outcomeOf(current) : { status: 'failed', code: 'order_not_found' };
  }

  /**
   * Handles the buyer's return. The order must belong to this gateway and the returned
   * transaction id must equal the one stored at checkout — that pair is the callback's state,
   * so a forged or replayed return can at most trigger a harmless re-verification. The return's
   * own status is never trusted: a "canceled" or "failed" return is verified with the gateway
   * too and closes the order only when the gateway reports it unpaid, and an OK return for an
   * order closed as unpaid is verified again.
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
      return outcomeOf(order, await ensureCredited(order, input.settings));
    }
    if (isClosed(order)) {
      return returned.status === 'ok' && isReverifiable(order)
        ? verifyAndSettle(order, driver, input.settings, 'callback')
        : outcomeOf(order);
    }
    if (returned.status !== 'ok') {
      logger.info(`[payments] order ${order.id} returned ${returned.status} from ${driver.name}`);
      const canceled = returned.status === 'canceled';
      return verifyAndSettle(order, driver, input.settings, 'callback', {
        status: canceled ? 'canceled' : 'failed',
        code: canceled ? 'canceled' : 'not_paid',
      });
    }
    return verifyAndSettle(order, driver, input.settings, 'callback');
  }

  /** Admin "check again" for one order; also re-verifies an order closed only as unpaid. */
  async function checkOrder(
    order: PaymentOrderRecord,
    settings: PaymentSettings,
  ): Promise<PaymentOutcome> {
    if (order.status === 'paid') {
      return outcomeOf(order, await ensureCredited(order, settings));
    }
    if (order.status !== 'pending' && order.status !== 'expired' && !isReverifiable(order)) {
      return outcomeOf(order);
    }
    const driver = deps.registry.get(order.gateway, settings);
    if (driver == null) {
      return { status: 'pending', orderId: order.id, code: 'gateway_unavailable' };
    }
    return verifyAndSettle(order, driver, settings, 'check');
  }

  /**
   * Re-verifies pending orders past their expiry, credits paid orders whose credit never
   * landed, and re-verifies once each recent order closed only as unpaid (after its expiry).
   * Orders run one after another so a backlog does not burst the gateway.
   */
  async function reconcile({
    resolveSettings,
    limit,
    reverifyClosedMinutes,
  }: {
    resolveSettings: (order: PaymentOrderRecord) => Promise<PaymentSettings>;
    limit?: number;
    reverifyClosedMinutes?: number;
  }): Promise<TAdminPaymentsReconcileResponse> {
    const at = now();
    const orders = await store.listPaymentOrdersToReconcile({
      now: at,
      limit,
      ...(reverifyClosedMinutes != null &&
        reverifyClosedMinutes > 0 && {
          reverifyClosedSince: new Date(at.getTime() - reverifyClosedMinutes * 60_000),
        }),
    });
    const summary = { checked: orders.length, paid: 0, expired: 0, credited: 0, failed: 0 };
    for (const order of orders) {
      try {
        if (order.status === 'paid') {
          summary.credited += (await ensureCredited(order, await resolveSettings(order))) ? 1 : 0;
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
