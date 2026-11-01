import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DEBUG_TRACE_KEEP_HOURS } from 'librechat-data-provider';
import type { DebugTraceAppend, DebugTraceLog, DebugTraceStage } from '@librechat/data-schemas';

/** Where a recorder's flushes go: `appendDebugTrace` on the `DebugTrace` collection. */
export interface DebugTraceSink {
  appendDebugTrace(input: DebugTraceAppend): Promise<void>;
}

export interface DebugTraceMeta {
  userId?: string;
  conversationId?: string;
  endpoint?: string;
  model?: string;
  spec?: string;
  path?: string;
}

/** Longest JSON one stage keeps; anything longer is cut and marked. */
const STAGE_DATA_CHARS = 8_000;
const FLUSH_DELAY_MS = 750;

const storage = new AsyncLocalStorage<DebugRecorder>();

/** JSON-safe, size-capped copy of a stage's data (cycles, functions and bigints survive). */
export function compactStageData(data: unknown): unknown {
  if (data === undefined) {
    return undefined;
  }
  const seen = new WeakSet<object>();
  let json: string;
  try {
    json = JSON.stringify(data, (_key, value: unknown) => {
      if (typeof value === 'bigint') {
        return value.toString();
      }
      if (typeof value === 'function') {
        return `[function ${(value as { name?: string }).name || 'anonymous'}]`;
      }
      if (value instanceof Error) {
        return { name: value.name, message: value.message };
      }
      if (value && typeof value === 'object') {
        if (seen.has(value)) {
          return '[circular]';
        }
        seen.add(value);
        if (value instanceof Map) {
          return Object.fromEntries(value);
        }
        if (value instanceof Set) {
          return [...value];
        }
      }
      return value;
    });
  } catch (error) {
    return { unserializable: (error as Error).message };
  }
  if (json === undefined) {
    return undefined;
  }
  if (json.length <= STAGE_DATA_CHARS) {
    return JSON.parse(json);
  }
  return { truncated: true, chars: json.length, preview: json.slice(0, STAGE_DATA_CHARS) };
}

/**
 * One traced chat request. Stages and log lines are buffered and written together a moment
 * later, so a request makes a handful of writes however much it logs. Its own writes run
 * outside the trace, so a failed flush cannot log itself back into the buffer.
 */
export class DebugRecorder {
  readonly traceId: string;
  private readonly startedAt = new Date();
  private meta: DebugTraceMeta;
  private status?: number;
  private stages: DebugTraceStage[] = [];
  private logs: DebugTraceLog[] = [];
  private errors = 0;
  private warnings = 0;
  private metaDirty = true;
  private timer: NodeJS.Timeout | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly sink: DebugTraceSink,
    meta: DebugTraceMeta,
    private readonly onFlushError?: (error: unknown) => void,
    traceId: string = randomUUID(),
  ) {
    this.meta = { ...meta };
    this.traceId = traceId;
  }

  stage(name: string, data?: unknown): void {
    this.stages.push({ name: name.slice(0, 100), at: new Date(), data: compactStageData(data) });
    this.schedule();
  }

  log(line: DebugTraceLog): void {
    this.logs.push(line);
    if (line.level === 'error') {
      this.errors += 1;
    } else if (line.level === 'warn') {
      this.warnings += 1;
    }
    this.schedule();
  }

  /** Fills in what the request learned later, such as a new conversation's id or the model. */
  update(meta: Partial<DebugTraceMeta> & { status?: number }): void {
    const { status, ...rest } = meta;
    for (const [key, value] of Object.entries(rest)) {
      if (typeof value === 'string' && value) {
        (this.meta as Record<string, string>)[key] = value;
        this.metaDirty = true;
      }
    }
    if (typeof status === 'number') {
      this.status = status;
      this.metaDirty = true;
    }
    this.schedule();
  }

  /** Writes what is buffered now; resolves once it is stored (or failed). */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.metaDirty && this.stages.length === 0 && this.logs.length === 0) {
      return this.chain;
    }
    const input: DebugTraceAppend = {
      traceId: this.traceId,
      ...this.meta,
      startedAt: this.startedAt,
      ...(this.status != null && { status: this.status }),
      stages: this.stages,
      logs: this.logs,
      errors: this.errors,
      warnings: this.warnings,
      keepHours: DEBUG_TRACE_KEEP_HOURS,
    };
    this.stages = [];
    this.logs = [];
    this.errors = 0;
    this.warnings = 0;
    this.metaDirty = false;
    this.chain = this.chain.then(() =>
      storage.exit(() =>
        this.sink.appendDebugTrace(input).catch((error: unknown) => this.onFlushError?.(error)),
      ),
    );
    return this.chain;
  }

  private schedule(): void {
    if (this.timer) {
      return;
    }
    this.timer = storage.exit(() =>
      setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, FLUSH_DELAY_MS),
    );
    this.timer.unref?.();
  }
}

/** Runs `fn` with `recorder` as the current trace for everything it starts. */
export function runWithDebugRecorder<T>(recorder: DebugRecorder, fn: () => T): T {
  return storage.run(recorder, fn);
}

/** The trace of the request this code runs for, when debug mode is recording it. */
export function getDebugRecorder(): DebugRecorder | undefined {
  return storage.getStore();
}

/**
 * Records one step of the current chat request. A no-op unless debug mode is on and recording
 * this request, so it is safe to call on hot paths. Never pass message text or secrets.
 */
export function debugTrace(name: string, data?: unknown | (() => unknown)): void {
  const recorder = storage.getStore();
  if (!recorder) {
    return;
  }
  recorder.stage(name, typeof data === 'function' ? (data as () => unknown)() : data);
}
