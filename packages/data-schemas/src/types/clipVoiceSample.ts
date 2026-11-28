import type { Document } from 'mongoose';

/** A stored voice sample: one short spoken line per model, voice and language. */
export interface ClipVoiceSampleRecord {
  key: string;
  mime: string;
  base64: string;
}

export interface IClipVoiceSample extends ClipVoiceSampleRecord, Document {
  createdAt?: Date;
  updatedAt?: Date;
}
