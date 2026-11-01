import { Schema } from 'mongoose';
import { BROWSER_END_REASONS, BROWSER_REFUSALS } from 'librechat-data-provider';
import type { IBrowserSession } from '~/types';

const browserSessionSchema: Schema<IBrowserSession> = new Schema<IBrowserSession>({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  sessionId: { type: String },
  outcome: { type: String, enum: ['opened', 'refused'], required: true },
  reason: { type: String, enum: [...BROWSER_REFUSALS, ...BROWSER_END_REASONS] },
  detail: { type: String, maxlength: 200 },
  startedAt: { type: Date, required: true },
  endedAt: { type: Date, default: null },
  durationMs: { type: Number, min: 0 },
  domains: { type: [String], default: [] },
  expiresAt: { type: Date, required: true },
  tenantId: { type: String, index: true },
});

browserSessionSchema.index({ startedAt: -1 });
browserSessionSchema.index({ user: 1, startedAt: -1 });
browserSessionSchema.index({ reason: 1, startedAt: -1 });
browserSessionSchema.index({ outcome: 1, endedAt: 1 });
/** One entry per browser, so an end reported twice updates it once */
browserSessionSchema.index(
  { sessionId: 1 },
  { unique: true, partialFilterExpression: { sessionId: { $type: 'string' } } },
);
browserSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default browserSessionSchema;
