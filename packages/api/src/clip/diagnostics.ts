export type ClipEventName =
  | 'tool.invoked'
  | 'tool.rejected'
  | 'tool.unconfigured'
  | 'worker.call'
  | 'worker.error'
  | 'worker.warning'
  | 'tool.saved'
  | 'tool.exception'
  | 'tool.busy'
  | 'preview.ok'
  | 'job.created'
  | 'job.submitted'
  | 'job.progress'
  | 'job.done'
  | 'job.failed'
  | 'job.cancelled';

export type ClipEventLevel = 'info' | 'warn' | 'error';

export type ClipEventData = Record<string, string | number | boolean | null | undefined>;

export interface ClipEvent {
  at: string;
  event: ClipEventName;
  level: ClipEventLevel;
  data: Record<string, string | number | boolean | null>;
}

export const CLIP_EVENT_LIMIT = 200;
const MAX_VALUE_CHARS = 240;
/** Keys that could carry user content or media: never recorded. */
const FORBIDDEN_KEY =
  /text|base64|body|heading|headline|narration|prompt|query|bullets|token|secret|authorization|password/i;

const events: ClipEvent[] = [];

function clean(data: ClipEventData): ClipEvent['data'] {
  const out: ClipEvent['data'] = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || FORBIDDEN_KEY.test(key)) {
      continue;
    }
    out[key] = typeof value === 'string' ? value.slice(0, MAX_VALUE_CHARS) : value;
  }
  return out;
}

/**
 * Remembers what the clip tool did, in this process, whether or not debug mode is on. Data only:
 * never pass message text, scene text or base64 (such keys are dropped as a second guard).
 */
export function recordClipEvent(
  input: { event: ClipEventName; level?: ClipEventLevel } & ClipEventData,
  now: () => number = Date.now,
): void {
  const { event, level = 'info', ...data } = input;
  events.push({ at: new Date(now()).toISOString(), event, level, data: clean(data) });
  if (events.length > CLIP_EVENT_LIMIT) {
    events.splice(0, events.length - CLIP_EVENT_LIMIT);
  }
}

/** Oldest first. */
export function getClipEvents(): ClipEvent[] {
  return events.map((entry) => ({ ...entry, data: { ...entry.data } }));
}

/** Test helper. */
export function clearClipEvents(): void {
  events.length = 0;
}
