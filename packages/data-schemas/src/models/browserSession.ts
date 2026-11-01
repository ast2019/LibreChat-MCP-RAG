import { Model } from 'mongoose';
import type * as t from '~/types';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import browserSessionSchema from '~/schema/browserSession';

export function createBrowserSessionModel(
  mongoose: typeof import('mongoose'),
): Model<t.IBrowserSession> {
  applyTenantIsolation(browserSessionSchema);
  return (
    mongoose.models.BrowserSession ||
    mongoose.model<t.IBrowserSession>('BrowserSession', browserSessionSchema)
  );
}
