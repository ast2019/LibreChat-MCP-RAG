import type { Document, Types } from 'mongoose';

/** One step a traced chat request went through, with what it decided. */
export interface DebugTraceStage {
  name: string;
  at: Date;
  data?: unknown;
}

/** One log line a traced chat request caused. */
export interface DebugTraceLog {
  at: Date;
  level: string;
  message: string;
  meta?: string;
}

/**
 * One chat request recorded while debug mode was on: the toggles it sent, the tools each step
 * kept or dropped, the tools the model got, and its log lines. Never holds message text.
 */
export interface IDebugTrace extends Document {
  _id: Types.ObjectId;
  traceId: string;
  user?: Types.ObjectId | null;
  conversationId?: string;
  endpoint?: string;
  /** The model id (`model` is taken by mongoose's Document) */
  modelId?: string;
  spec?: string;
  path?: string;
  startedAt: Date;
  status?: number;
  stages: DebugTraceStage[];
  logs: DebugTraceLog[];
  errorCount: number;
  warnCount: number;
  /** When the trace leaves the collection (TTL) */
  expiresAt: Date;
  tenantId?: string;
}

/** What a recorder sends in one flush; the first flush creates the trace. */
export interface DebugTraceAppend {
  traceId: string;
  userId?: string;
  conversationId?: string;
  endpoint?: string;
  model?: string;
  spec?: string;
  path?: string;
  startedAt: Date;
  status?: number;
  stages?: DebugTraceStage[];
  logs?: DebugTraceLog[];
  errors?: number;
  warnings?: number;
  keepHours: number;
}

export interface DebugTraceListParams {
  search?: string;
  problems?: boolean;
  limit?: number;
  offset?: number;
}

export interface DebugTraceListRow {
  id: string;
  user: { id: string; name?: string; email?: string } | null;
  conversationId?: string;
  endpoint?: string;
  model?: string;
  spec?: string;
  path?: string;
  startedAt: Date;
  status?: number;
  stageCount: number;
  logCount: number;
  errorCount: number;
  warnCount: number;
}

export interface DebugTraceDetail extends DebugTraceListRow {
  stages: DebugTraceStage[];
  logs: DebugTraceLog[];
}
