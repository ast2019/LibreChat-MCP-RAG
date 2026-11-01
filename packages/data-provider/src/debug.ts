/**
 * Debug mode: an admin turns it on for a few minutes from the admin panel («دیباگ»). While it
 * is on, every chat request records a trace (the toggles it sent, the tools each step kept or
 * dropped, the tools the model got, and the log lines it caused), and the server keeps its
 * recent log lines. It turns itself off when the time runs out.
 */

/** Log levels debug mode can capture, least to most verbose. */
export const DEBUG_LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;
export type TDebugLogLevel = (typeof DEBUG_LOG_LEVELS)[number];

/** Minutes the admin can pick; the server clamps anything else into this range. */
export const DEBUG_MODE_MINUTES = [15, 30, 60, 120] as const;
export const DEBUG_MODE_MAX_MINUTES = 240;
export const DEBUG_MODE_DEFAULT_MINUTES = 30;
/** Hours a recorded trace stays before Mongo removes it. */
export const DEBUG_TRACE_KEEP_HOURS = 48;

export interface TDebugModeState {
  enabled: boolean;
  /** ISO time debug mode turns itself off; null while off */
  enabledUntil: string | null;
  /** The admin who turned it on */
  enabledBy: string | null;
  level: TDebugLogLevel;
}

export interface TDebugModeUpdate {
  enabled: boolean;
  minutes?: number;
  level?: TDebugLogLevel;
}

export interface TDebugModeResponse extends TDebugModeState {
  /** Log lines this server process holds in memory */
  systemLogLines: number;
}

/** One step a traced request went through, with what it decided. */
export interface TDebugTraceStage {
  name: string;
  at: string;
  data?: unknown;
}

export interface TDebugLogLine {
  at: string;
  level: string;
  message: string;
  /** Extra fields the log call carried, as compact JSON */
  meta?: string;
  /** The traced request it belongs to, when it came from one */
  traceId?: string;
}

export interface TDebugTraceSummary {
  id: string;
  user: { id: string; name?: string; email?: string } | null;
  conversationId?: string;
  endpoint?: string;
  model?: string;
  spec?: string;
  path?: string;
  startedAt: string;
  status?: number;
  stageCount: number;
  logCount: number;
  errorCount: number;
  warnCount: number;
}

export interface TDebugTrace extends TDebugTraceSummary {
  stages: TDebugTraceStage[];
  logs: TDebugLogLine[];
}

export type TDebugTraceListParams = {
  /** A user's name or email, or a conversation id */
  search?: string;
  /** Only traces that logged an error or a warning */
  problems?: boolean;
  limit?: number;
  offset?: number;
};

export interface TDebugTraceListResponse {
  total: number;
  limit: number;
  offset: number;
  entries: TDebugTraceSummary[];
}

export interface TDebugSystemLogResponse {
  lines: TDebugLogLine[];
  /** Lines dropped since debug mode came on, because the buffer was full */
  dropped: number;
}
