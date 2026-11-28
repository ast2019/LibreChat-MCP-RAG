import type { Model } from 'mongoose';
import type { IClipVoiceSample, ClipVoiceSampleRecord } from '~/types';

export interface ClipVoiceSampleMethods {
  /** The stored sample for `key`, or null. */
  findClipVoiceSample: (key: string) => Promise<ClipVoiceSampleRecord | null>;
  /** Stores (or replaces) the sample for its key. */
  saveClipVoiceSample: (sample: ClipVoiceSampleRecord) => Promise<void>;
}

export function createClipVoiceSampleMethods(
  mongoose: typeof import('mongoose'),
): ClipVoiceSampleMethods {
  async function findClipVoiceSample(key: string): Promise<ClipVoiceSampleRecord | null> {
    const Sample = mongoose.models.ClipVoiceSample as Model<IClipVoiceSample>;
    const found = await Sample.findOne({ key }).lean();
    return found ? { key: found.key, mime: found.mime, base64: found.base64 } : null;
  }

  async function saveClipVoiceSample(sample: ClipVoiceSampleRecord): Promise<void> {
    const Sample = mongoose.models.ClipVoiceSample as Model<IClipVoiceSample>;
    await Sample.updateOne(
      { key: sample.key },
      { $set: { mime: sample.mime, base64: sample.base64 } },
      { upsert: true },
    );
  }

  return { findClipVoiceSample, saveClipVoiceSample };
}
