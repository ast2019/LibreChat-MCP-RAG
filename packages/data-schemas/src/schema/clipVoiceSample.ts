import { Schema } from 'mongoose';
import type { IClipVoiceSample } from '~/types';

/**
 * A pre-generated clip wizard voice sample, shared by every user and kept across restarts. The
 * key holds model, voice and language, so a changed voice config makes a new sample.
 */
const clipVoiceSampleSchema: Schema<IClipVoiceSample> = new Schema<IClipVoiceSample>(
  {
    key: { type: String, required: true, unique: true },
    mime: { type: String, required: true },
    base64: { type: String, required: true },
  },
  { timestamps: true },
);

export default clipVoiceSampleSchema;
