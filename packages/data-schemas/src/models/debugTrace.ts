import { Model } from 'mongoose';
import type * as t from '~/types';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import debugTraceSchema from '~/schema/debugTrace';

export function createDebugTraceModel(mongoose: typeof import('mongoose')): Model<t.IDebugTrace> {
  applyTenantIsolation(debugTraceSchema);
  return (
    mongoose.models.DebugTrace || mongoose.model<t.IDebugTrace>('DebugTrace', debugTraceSchema)
  );
}
