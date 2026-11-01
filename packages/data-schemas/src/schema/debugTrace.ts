import { Schema } from 'mongoose';
import type { IDebugTrace, DebugTraceLog, DebugTraceStage } from '~/types';

const stageSchema = new Schema<DebugTraceStage>(
  {
    name: { type: String, required: true },
    at: { type: Date, required: true },
    data: { type: Schema.Types.Mixed },
  },
  { _id: false },
);

const logSchema = new Schema<DebugTraceLog>(
  {
    at: { type: Date, required: true },
    level: { type: String, required: true },
    message: { type: String, default: '' },
    meta: { type: String },
  },
  { _id: false },
);

const debugTraceSchema: Schema<IDebugTrace> = new Schema<IDebugTrace>({
  traceId: { type: String, required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  conversationId: { type: String, maxlength: 100 },
  endpoint: { type: String, maxlength: 100 },
  modelId: { type: String, maxlength: 200 },
  spec: { type: String, maxlength: 200 },
  path: { type: String, maxlength: 300 },
  startedAt: { type: Date, required: true },
  status: { type: Number },
  stages: { type: [stageSchema], default: [] },
  logs: { type: [logSchema], default: [] },
  errorCount: { type: Number, default: 0, min: 0 },
  warnCount: { type: Number, default: 0, min: 0 },
  expiresAt: { type: Date, required: true },
  tenantId: { type: String, index: true },
});

debugTraceSchema.index({ traceId: 1 }, { unique: true });
debugTraceSchema.index({ startedAt: -1 });
debugTraceSchema.index({ user: 1, startedAt: -1 });
debugTraceSchema.index({ conversationId: 1, startedAt: -1 });
debugTraceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default debugTraceSchema;
