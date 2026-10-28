import { Schema } from 'mongoose';
import { PAYMENT_GATEWAYS, PAYMENT_ORDER_STATUSES } from 'librechat-data-provider';
import type { IPaymentOrder } from '~/types';

const paymentOrderSchema: Schema<IPaymentOrder> = new Schema<IPaymentOrder>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    packId: { type: String, required: true },
    packLabel: { type: String, required: true },
    credits: { type: Number, required: true, min: 1 },
    amountRial: { type: Number, required: true, min: 1 },
    gateway: { type: String, enum: PAYMENT_GATEWAYS, required: true },
    status: { type: String, enum: PAYMENT_ORDER_STATUSES, required: true, default: 'pending' },
    authority: { type: String },
    referenceId: { type: String },
    cardPan: { type: String },
    errorCode: { type: String },
    creditLeaseUntil: { type: Date, default: null },
    creditedAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
    tenantId: { type: String, index: true },
  },
  { timestamps: true },
);

paymentOrderSchema.index({ user: 1, createdAt: -1 });
paymentOrderSchema.index({ status: 1, createdAt: -1 });
paymentOrderSchema.index({ status: 1, paidAt: -1 });
paymentOrderSchema.index({ status: 1, expiresAt: 1 });
/** One order per gateway transaction, so a callback can never resolve to two orders */
paymentOrderSchema.index(
  { gateway: 1, authority: 1 },
  { unique: true, partialFilterExpression: { authority: { $type: 'string' } } },
);
/** One order per settlement reference: the second claim of a reference fails instead of
 *  crediting twice */
paymentOrderSchema.index(
  { gateway: 1, referenceId: 1 },
  { unique: true, partialFilterExpression: { referenceId: { $type: 'string' } } },
);

export default paymentOrderSchema;
