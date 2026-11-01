import winston from 'winston';
import { DEBUG_LOG_LEVELS } from 'librechat-data-provider';
import { baseLogFormat, logger } from '@librechat/data-schemas';
import type { TDebugLogLevel, TDebugLogLine, TDebugModeState } from 'librechat-data-provider';
import type TransportStream from 'winston-transport';
import type { DebugMode } from './mode';
import { getDebugRecorder } from './recorder';

const MESSAGE_CHARS = 2_000;
const META_CHARS = 2_000;
/** Lines this process keeps for «لاگ سرور»; older lines fall off */
export const SYSTEM_LOG_CAPACITY = 1_000;
const SKIPPED_KEYS = new Set(['level', 'message', 'timestamp', 'splat', 'stack']);

const rank = (level: string) => {
  const index = (DEBUG_LOG_LEVELS as readonly string[]).indexOf(level);
  return index === -1 ? DEBUG_LOG_LEVELS.length : index;
};

/** Recent log lines of this process, newest last; filled only while debug mode is on. */
export class SystemLogBuffer {
  private lines: TDebugLogLine[] = [];
  private dropped = 0;

  constructor(private readonly capacity: number = SYSTEM_LOG_CAPACITY) {}

  push(line: TDebugLogLine): void {
    this.lines.push(line);
    if (this.lines.length > this.capacity) {
      this.lines.splice(0, this.lines.length - this.capacity);
      this.dropped += 1;
    }
  }

  snapshot(): { lines: TDebugLogLine[]; dropped: number } {
    return { lines: [...this.lines], dropped: this.dropped };
  }

  get size(): number {
    return this.lines.length;
  }

  clear(): void {
    this.lines = [];
    this.dropped = 0;
  }
}

/** The redacted, size-capped line a winston `info` becomes. */
export function toDebugLogLine(info: winston.Logform.TransformableInfo): TDebugLogLine {
  const formatted = (baseLogFormat.transform(Object.assign({}, info), {}) ||
    info) as winston.Logform.TransformableInfo;
  const level = String(formatted.level ?? info.level);
  let message =
    typeof formatted.message === 'string' ? formatted.message : JSON.stringify(formatted.message);
  if (typeof formatted.stack === 'string' && level === 'error') {
    message = `${message}\n${formatted.stack}`;
  }
  const meta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(formatted)) {
    if (!SKIPPED_KEYS.has(key) && value !== undefined) {
      meta[key] = value;
    }
  }
  let metaJson: string | undefined;
  if (Object.keys(meta).length > 0) {
    try {
      metaJson = JSON.stringify(meta).slice(0, META_CHARS);
    } catch {
      metaJson = '[unserializable]';
    }
  }
  return {
    at: typeof formatted.timestamp === 'string' ? formatted.timestamp : new Date().toISOString(),
    level,
    message: (message ?? '').slice(0, MESSAGE_CHARS),
    ...(metaJson && { meta: metaJson }),
  };
}

/**
 * A winston transport that, while debug mode is on, copies each line at or above the chosen
 * level into the current request's trace and into this process's recent lines. Lines pass the
 * same redaction as the log files. The class is built on first use: winston's typings name its
 * base `transport` while the runtime calls it `Transport`, and some test setups replace winston.
 */
export function createDebugCaptureTransport(
  debugMode: DebugMode,
  buffer: SystemLogBuffer,
): TransportStream {
  const Base = (winston as unknown as { Transport: typeof TransportStream }).Transport;

  class DebugCaptureTransport extends Base {
    constructor() {
      super({ level: 'silly' });
    }

    override log(info: winston.Logform.TransformableInfo, next: () => void): void {
      try {
        if (debugMode.isActiveNow() && rank(String(info.level)) <= rank(debugMode.levelNow())) {
          const line = toDebugLogLine(info);
          const recorder = getDebugRecorder();
          if (recorder) {
            recorder.log({
              at: new Date(line.at),
              level: line.level,
              message: line.message,
              ...(line.meta && { meta: line.meta }),
            });
            line.traceId = recorder.traceId;
          }
          buffer.push(line);
        }
      } catch {
        /* A capture failure must never break logging */
      }
      next();
    }
  }

  return new DebugCaptureTransport();
}

/**
 * Makes the logger let through the chosen level while debug mode is on (production logs at
 * `warn`), and restores its own level when it goes off. Each transport keeps its own level:
 * the error file stays at `error` and the console at its level (`info` by default), so the
 * console shows info lines during the window and only this capture sees debug lines.
 */
export function followDebugLevel(
  target: { level: string } = logger,
): (state: TDebugModeState) => void {
  const original = target.level;
  return (state: TDebugModeState) => {
    const wanted: TDebugLogLevel | null = state.enabled ? state.level : null;
    target.level = wanted && rank(wanted) > rank(original) ? wanted : original;
  };
}

export interface DebugCapture {
  buffer: SystemLogBuffer;
}

let installed: DebugCapture | null = null;

/** Adds the capture transport once per process and keeps the switch fresh on every replica. */
export function installDebugCapture(
  debugMode: DebugMode,
  refreshMs: number = 15_000,
): DebugCapture {
  if (installed) {
    return installed;
  }
  const buffer = new SystemLogBuffer();
  logger.add(createDebugCaptureTransport(debugMode, buffer));
  const follow = followDebugLevel();
  let wasEnabled = false;
  debugMode.onChange((state) => {
    follow(state);
    /* A new window starts empty; lines from the last one stay readable after it ends */
    if (state.enabled && !wasEnabled) {
      buffer.clear();
    }
    wasEnabled = state.enabled;
  });
  const timer = setInterval(() => {
    void debugMode.getState();
  }, refreshMs);
  timer.unref?.();
  void debugMode.getState();
  installed = { buffer };
  return installed;
}
