import type { BalanceRefillMode, RefillIntervalUnit } from 'librechat-data-provider';
import type { Document, Types } from 'mongoose';

/** Whole credits held against a balance while the request that reserved them is in flight */
export interface IBalanceReservation {
  id: string;
  amount: number;
  expiresAt: Date;
}

/** An applied auto-refill whose ledger transaction has not been confirmed as recorded */
export interface IBalancePendingRefill {
  transactionId: Types.ObjectId;
  rawAmount: number;
  context?: 'autoRefill' | 'balanceReset';
}

export interface IBalance extends Document {
  user: Types.ObjectId;
  tokenCredits: number;
  // Automatic refill settings
  autoRefillEnabled: boolean;
  refillIntervalValue: number;
  refillIntervalUnit: RefillIntervalUnit;
  lastRefill: Date;
  refillAmount: number;
  refillMode?: BalanceRefillMode;
  tenantId?: string;
  /** Last credit pack granted to the user */
  packId?: string;
  packLabel?: string;
  /** Credits held right after the last pack grant */
  packAllotment?: number;
  packGrantedAt?: Date;
  timePackId?: string;
  timePackLabel?: string;
  timePackExpiresAt?: Date;
  timePackGrantedAt?: Date;
  timePackEndpoint?: string;
  /** Incremented by every time-pack grant; orders the copies of these fields onto the user */
  timePackRevision?: number;
  /** Reservation state is excluded from reads unless explicitly selected */
  reservations?: IBalanceReservation[];
  /** Sum of `reservations` amounts, maintained by the same writes */
  reservedCredits?: number;
  pendingRefill?: IBalancePendingRefill;
  /** Ids of the one-time credits (`applyBalanceCredit`) already added; never removed */
  appliedCredits?: string[];
}

/** Plain data fields for creating or updating a balance record (no Mongoose Document methods) */
export interface IBalanceUpdate {
  user?: string;
  tokenCredits?: number;
  autoRefillEnabled?: boolean;
  refillIntervalValue?: number;
  refillIntervalUnit?: RefillIntervalUnit;
  refillAmount?: number;
  refillMode?: BalanceRefillMode;
  lastRefill?: Date;
  packId?: string;
  packLabel?: string;
  packAllotment?: number;
  packGrantedAt?: Date;
  timePackId?: string;
  timePackLabel?: string;
  timePackExpiresAt?: Date;
  timePackGrantedAt?: Date;
  timePackEndpoint?: string;
}

/** One time-pack (re-)grant: the pack's fields and the days it adds. */
export interface TimePackGrant {
  timePackId: string;
  timePackLabel: string;
  timePackEndpoint: string;
  /** Whole days added to the later of `now` and the current expiry on the same endpoint */
  durationDays: number;
  now: Date;
}

/** A user's time-pack fields as a grant left them on the balance record. */
export interface GrantedTimePack {
  timePackId: string;
  timePackLabel: string;
  timePackEndpoint: string;
  timePackExpiresAt: Date;
  timePackGrantedAt: Date;
  timePackRevision: number;
}

/** A credit added to a user's balance at most once, identified by `creditId`. */
export interface BalanceCreditGrant {
  user: string;
  /** Stable id of this credit (for example a payment's ledger marker) */
  creditId: string;
  /** Positive credits to add */
  credits: number;
  /**
   * The pack this credit grants. Its fields are recorded with the new balance as the allotment,
   * unless a grant stamped after `grantedAfter` already owns them; then the allotment only grows
   * by `credits`.
   */
  pack?: { id: string; label: string };
  grantedAfter: Date;
  at: Date;
}

/** Holds credits against a user's balance for the lifetime of one in-flight request */
export interface BalanceReservationRequest {
  user: string;
  /** Unique per request; the release addresses the reservation by this id */
  reservationId: string;
  /** Credits the request is admitted against */
  amount: number;
  /** An unreleased reservation stops counting against the balance at this instant */
  expiresAt: Date;
  /** Creates the balance record with these fields when the user has none */
  initialBalance?: IBalanceUpdate;
  /** Current request policy; synchronized before existing-record admission without changing credits. */
  refillPolicy?: Pick<
    IBalanceUpdate,
    'refillAmount' | 'refillIntervalValue' | 'refillIntervalUnit'
  > & {
    autoRefillEnabled: boolean;
    refillMode: BalanceRefillMode;
  };
}

export interface BalanceReservationRenewal {
  user: string;
  reservationId: string;
  expiresAt: Date;
}

export interface BalanceReservationRelease {
  user: string;
  reservationId: string;
  /** The amount that was reserved */
  amount: number;
}

export interface BalanceReservationResult {
  reserved: boolean;
  /** Credits not held by other in-flight requests, after any auto-refill */
  balance: number;
}
