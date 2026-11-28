import { Model } from 'mongoose';
import type * as t from '~/types';
import clipVoiceSampleSchema from '~/schema/clipVoiceSample';

/** Platform-wide data: no tenant isolation, one sample serves every user. */
export function createClipVoiceSampleModel(
  mongoose: typeof import('mongoose'),
): Model<t.IClipVoiceSample> {
  return (
    mongoose.models.ClipVoiceSample ||
    mongoose.model<t.IClipVoiceSample>('ClipVoiceSample', clipVoiceSampleSchema)
  );
}
