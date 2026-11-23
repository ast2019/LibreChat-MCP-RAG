import { PAYMENT_REVERIFIABLE_CODES } from 'librechat-data-provider';
import type { TPaymentErrorCode, TPaymentOrderStatus } from 'librechat-data-provider';
import type { Model } from 'mongoose';
import type {
  IUser,
  IPaymentOrder,
  PaymentTotalsRow,
  PaymentSettlement,
  PaymentOrderRecord,
  PaymentOrderListRow,
  PaymentOrderListParams,
  PaymentOrderCreateData,
} from '~/types';
import type { ITransaction } from '~/schema/transaction';
import { isValidObjectIdString } from '~/utils/objectId';
import { createIndexesWithRetry } from '~/utils/retry';
import { buildUserSearchFilter } from '~/utils/search';
import logger from '~/config/winston';

const MAX_PAGE_SIZE = 100;
/** Statuses a verified payment may still settle from: an expired order can be paid late. */
const SETTLEABLE: TPaymentOrderStatus[] = ['pending', 'expired'];
/** Closed orders a later verify may still settle (see `PAYMENT_REVERIFIABLE_CODES`). */
const REOPENABLE: TPaymentOrderStatus[] = ['canceled', 'failed'];
const settleableFilter = {
  $or: [
    { status: { $in: SETTLEABLE } },
    { status: { $in: REOPENABLE }, errorCode: { $in: [...PAYMENT_REVERIFIABLE_CODES] } },
  ],
};

/** The ledger marker a payment's credit transaction carries, so a retry can detect it. */
export const paymentLedgerMarker = (orderId: string): string => `payment:${orderId}`;

/** Unique index on the payment markers: two credits of one order cannot both be written. */
export const PAYMENT_LEDGER_INDEX = 'payment_ledger_marker_unique';
/** Payment credits are pack grants that carry a marker; no other grant writes a messageId. */
const PAYMENT_LEDGER_FILTER = { context: 'pack', messageId: { $type: 'string' } };

export interface PaymentMethods {
  createPaymentOrder: (data: PaymentOrderCreateData) => Promise<PaymentOrderRecord>;
  /** Stores the gateway transaction id on a pending order; null when the order is not pending. */
  setPaymentOrderAuthority: (
    orderId: string,
    authority: string,
  ) => Promise<PaymentOrderRecord | null>;
  findPaymentOrderById: (orderId: string) => Promise<PaymentOrderRecord | null>;
  /**
   * Atomically moves a pending/expired order — or a canceled/failed one closed only as unpaid
   * (`PAYMENT_REVERIFIABLE_CODES`) — to `paid` and takes the credit lease. Resolves the
   * updated order for the single caller that won, null for everyone else. A reference id already
   * used by another order also resolves null (and never settles twice).
   */
  settlePaymentOrder: (
    orderId: string,
    settlement: PaymentSettlement,
  ) => Promise<PaymentOrderRecord | null>;
  /** Closes an open order as failed/canceled/expired; null when it was no longer open. */
  closePaymentOrder: (
    orderId: string,
    status: Extract<TPaymentOrderStatus, 'failed' | 'canceled' | 'expired'>,
    errorCode?: TPaymentErrorCode,
  ) => Promise<PaymentOrderRecord | null>;
  /** Re-takes the credit lease of a paid, uncredited order whose lease ran out. */
  claimPaymentOrderCredit: (orderId: string, now: Date, leaseUntil: Date) => Promise<boolean>;
  markPaymentOrderCredited: (orderId: string, at: Date) => Promise<void>;
  /**
   * Whether the ledger already holds this order's credit transaction. Resolves once the unique
   * payment-marker index exists (or could not be built), so a credit written after it is guarded.
   */
  hasPaymentLedgerEntry: (userId: string, orderId: string) => Promise<boolean>;
  listPaymentOrders: (
    params: PaymentOrderListParams,
  ) => Promise<{ orders: PaymentOrderListRow[]; total: number }>;
  /**
   * Pending orders past their expiry, paid orders still waiting for their credits and, when
   * `reverifyClosedSince` is set, canceled/failed orders closed only as unpaid, created since
   * then, past their expiry and not re-verified yet.
   */
  listPaymentOrdersToReconcile: (params: {
    now: Date;
    limit?: number;
    reverifyClosedSince?: Date;
  }) => Promise<PaymentOrderRecord[]>;
  /** Records that a closed order was re-verified, so reconciliation checks it only once. */
  markPaymentOrderReverified: (orderId: string, at: Date) => Promise<void>;
  getPaymentTotals: (params: { since: Date }) => Promise<PaymentTotalsRow>;
  countPendingPaymentOrders: () => Promise<number>;
  /** Last paid order and last failed order per gateway, for the status panel. */
  getPaymentGatewayActivity: () => Promise<
    { gateway: string; lastPaidAt?: Date; lastFailedAt?: Date }[]
  >;
}

type StoredOrder = Pick<
  IPaymentOrder,
  | 'packId'
  | 'packLabel'
  | 'credits'
  | 'amountRial'
  | 'gateway'
  | 'status'
  | 'authority'
  | 'referenceId'
  | 'cardPan'
  | 'errorCode'
  | 'creditedAt'
  | 'paidAt'
  | 'expiresAt'
  | 'tenantId'
  | 'createdAt'
> & { _id: { toString(): string }; user: { toString(): string } };

function toRecord(order: StoredOrder): PaymentOrderRecord {
  return {
    id: order._id.toString(),
    userId: order.user.toString(),
    packId: order.packId,
    packLabel: order.packLabel,
    credits: order.credits,
    amountRial: order.amountRial,
    gateway: order.gateway,
    status: order.status,
    ...(order.authority != null && { authority: order.authority }),
    ...(order.referenceId != null && { referenceId: order.referenceId }),
    ...(order.cardPan != null && { cardPan: order.cardPan }),
    ...(order.errorCode != null && { errorCode: order.errorCode }),
    credited: order.creditedAt != null,
    ...(order.paidAt != null && { paidAt: order.paidAt }),
    expiresAt: order.expiresAt,
    ...(order.tenantId != null && { tenantId: order.tenantId }),
    createdAt: order.createdAt ?? new Date(0),
  };
}

function isDuplicateKey(error: unknown): boolean {
  return (error as { code?: number } | null)?.code === 11000;
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function createPaymentMethods(mongoose: typeof import('mongoose')): PaymentMethods {
  const orders = () => mongoose.models.PaymentOrder as Model<IPaymentOrder>;
  const users = () => mongoose.models.User as Model<IUser>;
  const transactions = () => mongoose.models.Transaction as Model<ITransaction>;
  let indexes: Promise<void> | null = null;

  /**
   * The ledger's payment markers become unique. Existing data could hold a duplicate from the
   * race this guards against; then the build fails, the duplicates are named in the log for an
   * admin to review, and crediting carries on without the guard rather than stopping payments.
   */
  async function ensureLedgerIndex(): Promise<void> {
    try {
      await transactions().collection.createIndex(
        { messageId: 1 },
        {
          name: PAYMENT_LEDGER_INDEX,
          unique: true,
          partialFilterExpression: PAYMENT_LEDGER_FILTER,
        },
      );
    } catch (error) {
      if (!isDuplicateKey(error)) {
        throw error;
      }
      const duplicates = await transactions()
        .aggregate<{ _id: string; count: number }>([
          { $match: PAYMENT_LEDGER_FILTER },
          { $group: { _id: '$messageId', count: { $sum: 1 } } },
          { $match: { count: { $gt: 1 } } },
          { $limit: 50 },
        ])
        .exec();
      logger.error(
        '[payments] Payment orders credited more than once; the unique ledger guard is not built until they are resolved',
        { markers: duplicates.map((row) => row._id) },
      );
    }
  }

  /** The unique indexes are the double-credit guard, so writes wait until they exist. */
  function ensureIndexes(): Promise<void> {
    if (indexes == null) {
      indexes = Promise.all([createIndexesWithRetry(orders()), ensureLedgerIndex()])
        .then(() => undefined)
        .catch((error) => {
          indexes = null;
          throw error;
        });
    }
    return indexes;
  }

  const validId = (id: string) => typeof id === 'string' && isValidObjectIdString(id);

  async function createPaymentOrder(data: PaymentOrderCreateData): Promise<PaymentOrderRecord> {
    await ensureIndexes();
    const doc = await orders().create({ ...data, status: 'pending' });
    return toRecord(doc.toObject() as StoredOrder);
  }

  async function setPaymentOrderAuthority(orderId: string, authority: string) {
    if (!validId(orderId)) {
      return null;
    }
    await ensureIndexes();
    const doc = await orders()
      .findOneAndUpdate(
        { _id: orderId, status: 'pending', authority: { $exists: false } },
        { $set: { authority } },
        { new: true },
      )
      .lean();
    return doc ? toRecord(doc as StoredOrder) : null;
  }

  async function findPaymentOrderById(orderId: string) {
    if (!validId(orderId)) {
      return null;
    }
    const doc = await orders().findById(orderId).lean();
    return doc ? toRecord(doc as StoredOrder) : null;
  }

  async function settlePaymentOrder(orderId: string, settlement: PaymentSettlement) {
    if (!validId(orderId)) {
      return null;
    }
    await ensureIndexes();
    try {
      const doc = await orders()
        .findOneAndUpdate(
          { _id: orderId, ...settleableFilter },
          {
            $set: {
              status: 'paid',
              referenceId: settlement.referenceId,
              paidAt: settlement.paidAt,
              creditLeaseUntil: settlement.leaseUntil,
              ...(settlement.cardPan != null && { cardPan: settlement.cardPan }),
            },
            $unset: { errorCode: 1 },
          },
          { new: true },
        )
        .lean();
      return doc ? toRecord(doc as StoredOrder) : null;
    } catch (error) {
      if (isDuplicateKey(error)) {
        return null;
      }
      throw error;
    }
  }

  async function closePaymentOrder(
    orderId: string,
    status: 'failed' | 'canceled' | 'expired',
    errorCode?: TPaymentErrorCode,
  ) {
    if (!validId(orderId)) {
      return null;
    }
    const doc = await orders()
      .findOneAndUpdate(
        { _id: orderId, status: { $in: SETTLEABLE } },
        { $set: { status, ...(errorCode != null && { errorCode }) } },
        { new: true },
      )
      .lean();
    return doc ? toRecord(doc as StoredOrder) : null;
  }

  async function claimPaymentOrderCredit(orderId: string, now: Date, leaseUntil: Date) {
    if (!validId(orderId)) {
      return false;
    }
    const result = await orders().updateOne(
      {
        _id: orderId,
        status: 'paid',
        creditedAt: null,
        $or: [{ creditLeaseUntil: null }, { creditLeaseUntil: { $lte: now } }],
      },
      { $set: { creditLeaseUntil: leaseUntil } },
    );
    return result.modifiedCount === 1;
  }

  async function markPaymentOrderCredited(orderId: string, at: Date) {
    await orders().updateOne(
      { _id: orderId, status: 'paid' },
      { $set: { creditedAt: at, creditLeaseUntil: null } },
    );
  }

  async function hasPaymentLedgerEntry(userId: string, orderId: string) {
    if (!validId(userId) || !validId(orderId)) {
      return false;
    }
    await ensureIndexes();
    const found = await transactions().exists({
      user: userId,
      messageId: paymentLedgerMarker(orderId),
    });
    return found != null;
  }

  async function listPaymentOrders({
    status,
    gateway,
    search,
    limit = 25,
    offset = 0,
  }: PaymentOrderListParams) {
    const pageSize = Math.min(Math.max(Math.trunc(limit) || 25, 1), MAX_PAGE_SIZE);
    const skip = Math.max(Math.trunc(offset) || 0, 0);
    const filter: Record<string, unknown> = {};
    if (status) {
      filter.status = status;
    }
    if (gateway) {
      filter.gateway = gateway;
    }
    const trimmed = typeof search === 'string' ? search.trim().slice(0, 200) : '';
    if (trimmed) {
      const or: Record<string, unknown>[] = [
        { referenceId: trimmed },
        { authority: trimmed },
        { packId: { $regex: `^${escapeRegex(trimmed)}`, $options: 'i' } },
      ];
      if (isValidObjectIdString(trimmed)) {
        or.push({ _id: trimmed }, { user: trimmed });
      }
      const userFilter = buildUserSearchFilter(trimmed, { legacyPrefix: true });
      if (userFilter) {
        const matched = await users().find(userFilter, '_id').limit(200).lean();
        if (matched.length > 0) {
          or.push({ user: { $in: matched.map((user) => user._id) } });
        }
      }
      filter.$or = or;
    }

    const [docs, total] = await Promise.all([
      orders().find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
      orders().countDocuments(filter),
    ]);
    const userIds = [...new Set(docs.map((doc) => doc.user.toString()))];
    const owners = userIds.length
      ? await users()
          .find({ _id: { $in: userIds } }, '_id email name')
          .lean()
      : [];
    const byId = new Map(owners.map((user) => [user._id.toString(), user]));
    return {
      total,
      orders: docs.map((doc) => {
        const record = toRecord(doc as StoredOrder);
        const owner = byId.get(record.userId);
        return {
          ...record,
          user: {
            id: record.userId,
            ...(owner?.email && { email: owner.email }),
            ...(owner?.name && { name: owner.name }),
          },
        };
      }),
    };
  }

  async function listPaymentOrdersToReconcile({
    now,
    limit = 50,
    reverifyClosedSince,
  }: {
    now: Date;
    limit?: number;
    reverifyClosedSince?: Date;
  }) {
    const docs = await orders()
      .find({
        $or: [
          { status: 'pending', expiresAt: { $lte: now } },
          {
            status: 'paid',
            creditedAt: null,
            $or: [{ creditLeaseUntil: null }, { creditLeaseUntil: { $lte: now } }],
          },
          ...(reverifyClosedSince != null
            ? [
                {
                  status: { $in: REOPENABLE },
                  errorCode: { $in: [...PAYMENT_REVERIFIABLE_CODES] },
                  authority: { $type: 'string' },
                  reverifiedAt: null,
                  createdAt: { $gte: reverifyClosedSince },
                  expiresAt: { $lte: now },
                },
              ]
            : []),
        ],
      })
      .sort({ createdAt: 1 })
      .limit(Math.min(Math.max(Math.trunc(limit) || 50, 1), 200))
      .lean();
    return docs.map((doc) => toRecord(doc as StoredOrder));
  }

  async function markPaymentOrderReverified(orderId: string, at: Date) {
    if (!validId(orderId)) {
      return;
    }
    await orders().updateOne(
      { _id: orderId, status: { $in: REOPENABLE } },
      { $set: { reverifiedAt: at } },
    );
  }

  async function getPaymentTotals({ since }: { since: Date }): Promise<PaymentTotalsRow> {
    const [row] = await orders().aggregate<PaymentTotalsRow>([
      { $match: { status: 'paid', paidAt: { $gte: since } } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          amountRial: { $sum: '$amountRial' },
          credits: { $sum: '$credits' },
        },
      },
      { $project: { _id: 0, count: 1, amountRial: 1, credits: 1 } },
    ]);
    return row ?? { count: 0, amountRial: 0, credits: 0 };
  }

  async function countPendingPaymentOrders() {
    return orders().countDocuments({ status: 'pending' });
  }

  async function getPaymentGatewayActivity() {
    const rows = await orders().aggregate<{
      _id: string;
      lastPaidAt?: Date | null;
      lastFailedAt?: Date | null;
    }>([
      { $match: { status: { $in: ['paid', 'failed'] } } },
      {
        $group: {
          _id: '$gateway',
          lastPaidAt: { $max: { $cond: [{ $eq: ['$status', 'paid'] }, '$paidAt', null] } },
          lastFailedAt: {
            $max: { $cond: [{ $eq: ['$status', 'failed'] }, '$updatedAt', null] },
          },
        },
      },
    ]);
    return rows.map((row) => ({
      gateway: row._id,
      ...(row.lastPaidAt != null && { lastPaidAt: row.lastPaidAt }),
      ...(row.lastFailedAt != null && { lastFailedAt: row.lastFailedAt }),
    }));
  }

  return {
    createPaymentOrder,
    setPaymentOrderAuthority,
    findPaymentOrderById,
    settlePaymentOrder,
    closePaymentOrder,
    claimPaymentOrderCredit,
    markPaymentOrderCredited,
    hasPaymentLedgerEntry,
    listPaymentOrders,
    listPaymentOrdersToReconcile,
    markPaymentOrderReverified,
    getPaymentTotals,
    countPendingPaymentOrders,
    getPaymentGatewayActivity,
  };
}
