import { Model } from 'mongoose';
import type * as t from '~/types';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import paymentOrderSchema from '~/schema/payment';

export function createPaymentOrderModel(
  mongoose: typeof import('mongoose'),
): Model<t.IPaymentOrder> {
  applyTenantIsolation(paymentOrderSchema);
  return (
    mongoose.models.PaymentOrder ||
    mongoose.model<t.IPaymentOrder>('PaymentOrder', paymentOrderSchema)
  );
}
