/** The first `remaining` seen on a UTC day. */
export interface HistoryEntry {
  day: string;
  at: number;
  remaining: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Usage is averaged over at most this many days, so an old burst does not skew the estimate. */
const WINDOW_DAYS = 7;
/** Shorter spans say too little about a daily rate. */
const MIN_SPAN_MS = 6 * 60 * 60 * 1000;

export const toDay = (at: number): string => new Date(at).toISOString().slice(0, 10);

function isEntry(value: unknown): value is HistoryEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const entry = value as Partial<HistoryEntry>;
  return (
    typeof entry.day === 'string' &&
    typeof entry.at === 'number' &&
    typeof entry.remaining === 'number'
  );
}

export function parseHistory(value: unknown): HistoryEntry[] {
  return Array.isArray(value) ? value.filter(isEntry) : [];
}

/** Keeps the first reading of each day and drops days older than `historyDays`. */
export function appendHistory(
  history: HistoryEntry[],
  remaining: number,
  at: number,
  historyDays: number,
): HistoryEntry[] {
  const day = toDay(at);
  const cutoff = toDay(at - (historyDays - 1) * DAY_MS);
  const kept = history.filter((entry) => entry.day >= cutoff);
  if (kept.some((entry) => entry.day === day)) {
    return kept;
  }
  return [...kept, { day, at, remaining }];
}

/**
 * Days until `remaining` reaches zero at the recent rate: from the earliest reading in the last
 * week that was not followed by a top-up, to now. Null when nothing was used or the span is too
 * short to tell.
 */
export function estimateDaysLeft(
  history: HistoryEntry[],
  remaining: number,
  now: number,
): number | null {
  if (remaining <= 0) {
    return 0;
  }
  const recent = history.filter(
    (entry) => entry.at >= now - WINDOW_DAYS * DAY_MS && entry.at < now,
  );
  let start: HistoryEntry | undefined;
  let next = remaining;
  for (let index = recent.length - 1; index >= 0; index--) {
    if (recent[index].remaining < next) {
      break;
    }
    start = recent[index];
    next = recent[index].remaining;
  }
  if (!start || now - start.at < MIN_SPAN_MS) {
    return null;
  }
  const used = start.remaining - remaining;
  if (used <= 0) {
    return null;
  }
  const perDay = used / ((now - start.at) / DAY_MS);
  return Math.round((remaining / perDay) * 10) / 10;
}

/** Days left from a per-day count of requests (oldest first), one request costing one unit. */
export function estimateDaysFromCounts(counts: number[], remaining: number): number | null {
  const recent = counts.slice(-WINDOW_DAYS);
  const used = recent.reduce((sum, count) => sum + count, 0);
  if (used <= 0 || recent.length === 0) {
    return null;
  }
  return Math.round((remaining / (used / recent.length)) * 10) / 10;
}
