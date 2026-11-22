import { Schema } from 'mongoose';
import type { IMediaJob } from '~/types';

/**
 * A long generation running in the background (a provider video, or a storyboard clip on the
 * Remotion worker); a worker polls it and delivers the file.
 */
const mediaJobSchema: Schema<IMediaJob> = new Schema<IMediaJob>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: ['video', 'clip'], required: true },
    provider: { type: String, enum: ['openrouter', 'higgsfield', 'remotion'], required: true },
    providerJobId: { type: String, required: true },
    providerModel: { type: String, required: true },
    label: { type: String },
    endpoint: { type: String, required: true },
    context: { type: String, required: true },
    conversationId: { type: String },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed'],
      required: true,
      default: 'pending',
    },
    errorCode: { type: String },
    fallbackUsd: { type: Number, required: true, min: 0 },
    priceMultiplier: { type: Number, required: true, min: 0 },
    file_id: { type: String },
    filepath: { type: String },
    type: { type: String },
    chargedCredits: { type: Number },
    pollIntervalMs: { type: Number, required: true, min: 1000 },
    nextPollAt: { type: Date, required: true },
    leaseUntil: { type: Date, default: null },
    deadline: { type: Date, required: true },
    tenantId: { type: String, index: true },
    progress: { type: Number, min: 0, max: 1 },
    stage: { type: String },
    payload: { type: Schema.Types.Mixed },
    workerJobId: { type: String },
    cancelRequested: { type: Boolean },
    warnings: { type: [String], default: undefined },
  },
  { timestamps: true },
);

mediaJobSchema.index({ status: 1, nextPollAt: 1 });
mediaJobSchema.index({ user: 1, kind: 1, status: 1 });

export default mediaJobSchema;
