import type {
  TPaymentGateway,
  TPaymentErrorCode,
  TPaymentOrderStatus,
} from 'librechat-data-provider';
import type { Document, Types } from 'mongoose';

export interface IPaymentOrder extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  packId: string;
  packLabel: string;
  credits: number;
  /** Server-computed price in rials; the gateway is verified against this */
  amountRial: number;
  gateway: TPaymentGateway;
  status: TPaymentOrderStatus;
  /** The gateway's transaction id (Zarinpal `authority`, IDPay `id`) */
  authority?: string;
  /** The gateway's settlement reference (Zarinpal `ref_id`, IDPay `track_id`) */
  referenceId?: string;
  cardPan?: string;
  errorCode?: TPaymentErrorCode;
  /** Exclusive credit claim: whoever holds an unexpired lease may grant the credits */
  creditLeaseUntil?: Date | null;
  creditedAt?: Date | null;
  paidAt?: Date | null;
  expiresAt: Date;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface PaymentOrderCreateData {
  user: string;
  packId: string;
  packLabel: string;
  credits: number;
  amountRial: number;
  gateway: TPaymentGateway;
  expiresAt: Date;
}

/** A stored order as plain data; ids are strings. */
export interface PaymentOrderRecord {
  id: string;
  userId: string;
  packId: string;
  packLabel: string;
  credits: number;
  amountRial: number;
  gateway: TPaymentGateway;
  status: TPaymentOrderStatus;
  authority?: string;
  referenceId?: string;
  cardPan?: string;
  errorCode?: TPaymentErrorCode;
  credited: boolean;
  paidAt?: Date;
  expiresAt: Date;
  tenantId?: string;
  createdAt: Date;
}

export interface PaymentOrderListParams {
  status?: TPaymentOrderStatus;
  gateway?: TPaymentGateway;
  /** Email/name fragment, user id, reference id or authority */
  search?: string;
  limit?: number;
  offset?: number;
}

export interface PaymentOrderListRow extends PaymentOrderRecord {
  user: { id: string; email?: string; name?: string };
}

export interface PaymentTotalsRow {
  count: number;
  amountRial: number;
  credits: number;
}

export interface PaymentSettlement {
  referenceId: string;
  cardPan?: string;
  paidAt: Date;
  /** How long the winner may hold the credit claim */
  leaseUntil: Date;
}
