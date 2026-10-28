import { logger, isValidObjectIdString } from '@librechat/data-schemas';
import { isPaymentGateway, PAYMENT_ORDER_STATUSES } from 'librechat-data-provider';
import type {
  IUser,
  AppConfig,
  PaymentTotalsRow,
  PaymentOrderRecord,
  PaymentOrderListRow,
  PaymentOrderListParams,
} from '@librechat/data-schemas';
import type {
  TPaymentOrder,
  TAdminPaymentOrder,
  TPaymentOrderStatus,
  TAdminPaymentsSummary,
} from 'librechat-data-provider';
import type { Request, Response } from 'express';
import type { PaymentStore, PaymentService, PaymentOutcome, PaymentServiceDeps } from './service';
import type { CurrencyRates, InterfaceCurrency } from '~/billing/currency';
import type { PaymentDriverRegistry } from './registry';
import type { PaymentGatewayActivity } from './status';
import type { GatewayHealth } from './health';
import type { PaymentsEnv } from './config';
import { createPaymentService, getPaymentOptions } from './service';
import { createPaymentDriverRegistry } from './registry';
import { getPaymentGatewaysStatus } from './status';
import { resolvePaymentSettings } from './config';
import { getBalanceConfig } from '~/app/config';
import { readParam } from './http';

type PaymentRequest = Request & { user?: IUser };

export interface PaymentAdminStore {
  listPaymentOrders: (
    params: PaymentOrderListParams,
  ) => Promise<{ orders: PaymentOrderListRow[]; total: number }>;
  getPaymentTotals: (params: { since: Date }) => Promise<PaymentTotalsRow>;
  countPendingPaymentOrders: () => Promise<number>;
  getPaymentGatewayActivity: () => Promise<PaymentGatewayActivity[]>;
}

export interface PaymentHandlerDeps {
  /** The requesting user's app config (role/tenant overrides applied) */
  getAppConfig: (req: PaymentRequest) => Promise<AppConfig>;
  /** Base config of an order's tenant, for unauthenticated callbacks and reconciliation */
  getTenantAppConfig: (tenantId?: string) => Promise<AppConfig>;
  currencyRates: CurrencyRates;
  store: PaymentStore & PaymentAdminStore;
  grant: PaymentServiceDeps['grant'];
  registry?: PaymentDriverRegistry;
  fetch?: typeof fetch;
  health?: GatewayHealth;
  env?: PaymentsEnv;
  /** Cross-tenant lookup of the order a callback names */
  asSystem?: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Runs the rest of a callback in the order's tenant */
  withTenant?: <T>(tenantId: string | undefined, fn: () => Promise<T>) => Promise<T>;
  now?: () => Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Tehran has had no daylight saving since 2022 */
const TEHRAN_OFFSET_MS = 3.5 * 60 * 60 * 1000;
const persianDay = new Intl.DateTimeFormat('en-US-u-ca-persian', {
  day: 'numeric',
  timeZone: 'Asia/Tehran',
});

/** Midnight in Tehran today, and the first day of the current Persian (Jalali) month. */
export function getTehranWindows(now: Date): { todaySince: Date; monthSince: Date } {
  const todaySince = new Date(
    Math.floor((now.getTime() + TEHRAN_OFFSET_MS) / DAY_MS) * DAY_MS - TEHRAN_OFFSET_MS,
  );
  const dayOfMonth = Number.parseInt(persianDay.format(now).replace(/\D/g, ''), 10);
  const back = Number.isFinite(dayOfMonth) && dayOfMonth > 0 ? dayOfMonth - 1 : 0;
  return { todaySince, monthSince: new Date(todaySince.getTime() - back * DAY_MS) };
}

function toUserOrder(order: PaymentOrderRecord): TPaymentOrder {
  return {
    id: order.id,
    packId: order.packId,
    packLabel: order.packLabel,
    credits: order.credits,
    amountRial: order.amountRial,
    gateway: order.gateway,
    status: order.status,
    ...(order.referenceId != null && { referenceId: order.referenceId }),
    ...(order.errorCode != null && { errorCode: order.errorCode }),
    credited: order.credited,
    createdAt: order.createdAt.toISOString(),
    ...(order.paidAt != null && { paidAt: order.paidAt.toISOString() }),
  };
}

function toAdminOrder(
  order: PaymentOrderRecord,
  user: TAdminPaymentOrder['user'] = { id: order.userId },
): TAdminPaymentOrder {
  return {
    ...toUserOrder(order),
    user,
    ...(order.cardPan != null && { cardPan: order.cardPan }),
    ...(order.authority != null && { authority: order.authority }),
    expiresAt: order.expiresAt.toISOString(),
  };
}

function readInt(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

const identity = <T>(fn: () => Promise<T>) => fn();

/**
 * HTTP handlers for `/api/payments`. Callers mount `checkout`, `options` and `getOrder` behind
 * JWT auth (checkout also behind a rate limit), the `admin*` handlers behind an admin
 * capability, and `callback` unauthenticated — its state is the order id + gateway
 * transaction id pair, checked by the service.
 */
type PaymentHandler = (req: PaymentRequest, res: Response) => Promise<Response | void>;

/** Express handlers of the payment routes (see {@link createPaymentHandlers}). */
export interface PaymentHandlers {
  options: PaymentHandler;
  checkout: PaymentHandler;
  callback: PaymentHandler;
  getOrder: PaymentHandler;
  adminList: PaymentHandler;
  adminSummary: PaymentHandler;
  adminVerify: PaymentHandler;
  adminReconcile: PaymentHandler;
  adminStatus: PaymentHandler;
  service: PaymentService;
}

export function createPaymentHandlers(deps: PaymentHandlerDeps): PaymentHandlers {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const asSystem = deps.asSystem ?? identity;
  const withTenant =
    deps.withTenant ?? (<T>(_tenantId: string | undefined, fn: () => Promise<T>) => fn());
  const registry = deps.registry ?? createPaymentDriverRegistry({ fetch: deps.fetch });
  const service = createPaymentService({
    store: deps.store,
    grant: deps.grant,
    registry,
    health: deps.health,
    now,
  });

  const settingsFor = async (tenantId?: string) =>
    resolvePaymentSettings(await deps.getTenantAppConfig(tenantId), env);

  async function resolveRequest(req: PaymentRequest) {
    const appConfig = await deps.getAppConfig(req);
    const settings = resolvePaymentSettings(appConfig, env);
    const { currency } = await deps.currencyRates.resolve(
      appConfig?.interfaceConfig?.currency as InterfaceCurrency | undefined,
    );
    return { appConfig, settings, balance: getBalanceConfig(appConfig), currency };
  }

  /** The client's result page; absolute when the client has its own origin. */
  function resultUrl(outcome: PaymentOutcome): string {
    const base = (env.DOMAIN_CLIENT ?? '').trim().replace(/\/+$/, '');
    const query = new URLSearchParams({ status: outcome.status });
    if (outcome.orderId) {
      query.set('order', outcome.orderId);
    }
    if (outcome.code) {
      query.set('code', outcome.code);
    }
    return `${/^https?:\/\//i.test(base) ? base : ''}/payment/result?${query.toString()}`;
  }

  async function options(req: PaymentRequest, res: Response) {
    try {
      const { settings, balance, currency } = await resolveRequest(req);
      return res.status(200).json(getPaymentOptions(settings, balance, currency));
    } catch (error) {
      logger.error('[payments] options error:', error);
      return res.status(500).json({ error: { code: 'payments_disabled' } });
    }
  }

  async function checkout(req: PaymentRequest, res: Response) {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: { code: 'payments_disabled' } });
    }
    try {
      const { settings, balance, currency } = await resolveRequest(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const result = await service.checkout({
        settings,
        balance,
        currency,
        userId,
        packId: body.packId,
        gateway: body.gateway,
      });
      if (!result.ok) {
        return res.status(result.error.status).json({ error: { code: result.error.code } });
      }
      return res.status(200).json(result.value);
    } catch (error) {
      logger.error('[payments] checkout error:', error);
      return res.status(500).json({ error: { code: 'purchase_failed' } });
    }
  }

  async function callback(req: PaymentRequest, res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    const gateway = req.params?.gateway;
    const orderId = readParam((req.query ?? {}) as Record<string, unknown>, 'order');
    const body =
      req.body != null && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};
    const params = { ...(req.query as Record<string, unknown>), ...body };
    let outcome: PaymentOutcome;
    try {
      const order =
        orderId != null && isValidObjectIdString(orderId) && isPaymentGateway(gateway)
          ? await asSystem(() => deps.store.findPaymentOrderById(orderId))
          : null;
      outcome = await withTenant(order?.tenantId, async () =>
        service.completeCallback({
          settings: await settingsFor(order?.tenantId),
          gateway: String(gateway ?? ''),
          order,
          params,
        }),
      );
    } catch (error) {
      logger.error('[payments] callback error:', error);
      outcome = {
        status: 'pending',
        ...(orderId != null && isValidObjectIdString(orderId) && { orderId }),
        code: 'verify_failed',
      };
    }
    return res.redirect(303, resultUrl(outcome));
  }

  async function getOrder(req: PaymentRequest, res: Response) {
    try {
      const orderId = req.params?.orderId;
      const order =
        typeof orderId === 'string' ? await deps.store.findPaymentOrderById(orderId) : null;
      /** Someone else's order answers exactly like a missing one */
      if (order == null || order.userId !== req.user?.id) {
        return res.status(404).json({ error: { code: 'order_not_found' } });
      }
      return res.status(200).json(toUserOrder(order));
    } catch (error) {
      logger.error('[payments] getOrder error:', error);
      return res.status(500).json({ error: { code: 'order_not_found' } });
    }
  }

  async function adminList(req: PaymentRequest, res: Response) {
    try {
      const query = (req.query ?? {}) as Record<string, unknown>;
      const status = (PAYMENT_ORDER_STATUSES as readonly unknown[]).includes(query.status)
        ? (query.status as TPaymentOrderStatus)
        : undefined;
      const gateway = isPaymentGateway(query.gateway) ? query.gateway : undefined;
      const search = typeof query.search === 'string' ? query.search : undefined;
      const limit = Math.min(Math.max(readInt(query.limit, 25), 1), 100);
      const offset = Math.max(readInt(query.offset, 0), 0);
      const { orders, total } = await deps.store.listPaymentOrders({
        status,
        gateway,
        search,
        limit,
        offset,
      });
      return res.status(200).json({
        total,
        limit,
        offset,
        orders: orders.map((row) => toAdminOrder(row, row.user)),
      });
    } catch (error) {
      logger.error('[payments] adminList error:', error);
      return res.status(500).json({ error: 'Failed to list payments' });
    }
  }

  async function adminSummary(_req: PaymentRequest, res: Response) {
    try {
      const { todaySince, monthSince } = getTehranWindows(now());
      const [today, month, pending] = await Promise.all([
        deps.store.getPaymentTotals({ since: todaySince }),
        deps.store.getPaymentTotals({ since: monthSince }),
        deps.store.countPendingPaymentOrders(),
      ]);
      const summary: TAdminPaymentsSummary = {
        todaySince: todaySince.toISOString(),
        monthSince: monthSince.toISOString(),
        today,
        month,
        pending,
      };
      return res.status(200).json(summary);
    } catch (error) {
      logger.error('[payments] adminSummary error:', error);
      return res.status(500).json({ error: 'Failed to build payment summary' });
    }
  }

  async function adminVerify(req: PaymentRequest, res: Response) {
    try {
      const orderId = req.params?.orderId;
      const order =
        typeof orderId === 'string' ? await deps.store.findPaymentOrderById(orderId) : null;
      if (order == null) {
        return res.status(404).json({ error: { code: 'order_not_found' } });
      }
      await service.checkOrder(order, await settingsFor(order.tenantId));
      const current = (await deps.store.findPaymentOrderById(order.id)) ?? order;
      logger.info(`[payments] ${req.user?.id ?? 'unknown admin'} re-checked order ${order.id}`);
      return res.status(200).json({ order: toAdminOrder(current) });
    } catch (error) {
      logger.error('[payments] adminVerify error:', error);
      return res.status(500).json({ error: { code: 'verify_failed' } });
    }
  }

  async function adminReconcile(req: PaymentRequest, res: Response) {
    try {
      const cache = new Map<string, ReturnType<typeof settingsFor>>();
      const result = await service.reconcile({
        resolveSettings: (order) => {
          const key = order.tenantId ?? '';
          let settings = cache.get(key);
          if (settings == null) {
            settings = settingsFor(order.tenantId);
            cache.set(key, settings);
          }
          return settings;
        },
      });
      logger.info(`[payments] ${req.user?.id ?? 'unknown admin'} reconciled payments`, result);
      return res.status(200).json(result);
    } catch (error) {
      logger.error('[payments] adminReconcile error:', error);
      return res.status(500).json({ error: { code: 'verify_failed' } });
    }
  }

  /** Gateway status rows for the admin status panel (no secrets). */
  async function adminStatus(req: PaymentRequest, res: Response) {
    try {
      const [appConfig, activity] = await Promise.all([
        deps.getAppConfig(req),
        deps.store.getPaymentGatewayActivity(),
      ]);
      return res.status(200).json({
        gateways: getPaymentGatewaysStatus(appConfig, { env, health: deps.health, activity }),
      });
    } catch (error) {
      logger.error('[payments] adminStatus error:', error);
      return res.status(500).json({ error: 'Failed to read gateway status' });
    }
  }

  return {
    options,
    checkout,
    callback,
    getOrder,
    adminList,
    adminSummary,
    adminVerify,
    adminReconcile,
    adminStatus,
    service,
  };
}
