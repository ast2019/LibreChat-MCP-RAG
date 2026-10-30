import { Model } from 'mongoose';
import type * as t from '~/types';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import mediaJobSchema from '~/schema/mediaJob';

export function createMediaJobModel(mongoose: typeof import('mongoose')): Model<t.IMediaJob> {
  applyTenantIsolation(mediaJobSchema);
  return mongoose.models.MediaJob || mongoose.model<t.IMediaJob>('MediaJob', mediaJobSchema);
}
