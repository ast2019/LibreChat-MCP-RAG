import {
  DEBUG_LOG_LEVELS,
  DEBUG_MODE_MAX_MINUTES,
  DEBUG_MODE_DEFAULT_MINUTES,
} from 'librechat-data-provider';
import type { TDebugLogLevel, TDebugModeState } from 'librechat-data-provider';

/** What the store keeps while debug mode is on; absent once it is off or has run out. */
export interface StoredDebugMode {
  enabledUntil: number;
  enabledBy: string;
  level: TDebugLogLevel;
}

/**
 * Where the switch lives. The cache it is wired to is Redis when the deployment has it, so every
 * replica sees one switch, and the stored entry expires with the debug window.
 */
export interface DebugModeStore {
  get(): Promise<StoredDebugMode | undefined>;
  set(value: StoredDebugMode, ttlMs: number): Promise<void>;
  delete(): Promise<void>;
}

export interface DebugMode {
  /** The switch, read at most once every few seconds per process */
  getState(): Promise<TDebugModeState>;
  /** Whether debug mode is on, from the last read; for log paths that cannot wait */
  isActiveNow(): boolean;
  /** The level the last read found, for log paths that cannot wait */
  levelNow(): TDebugLogLevel;
  enable(input: { minutes?: number; level?: TDebugLogLevel; by: string }): Promise<TDebugModeState>;
  disable(): Promise<TDebugModeState>;
  /** Called with each new state, so the log level can follow the switch */
  onChange(listener: (state: TDebugModeState) => void): void;
}

const REFRESH_MS = 5_000;

export const clampDebugMinutes = (minutes: unknown): number => {
  const value = typeof minutes === 'number' && Number.isFinite(minutes) ? minutes : NaN;
  if (Number.isNaN(value)) {
    return DEBUG_MODE_DEFAULT_MINUTES;
  }
  return Math.min(Math.max(1, Math.round(value)), DEBUG_MODE_MAX_MINUTES);
};

export const isDebugLogLevel = (level: unknown): level is TDebugLogLevel =>
  typeof level === 'string' && (DEBUG_LOG_LEVELS as readonly string[]).includes(level);

const OFF: TDebugModeState = { enabled: false, enabledUntil: null, enabledBy: null, level: 'warn' };

export function createDebugMode({
  store,
  now = Date.now,
}: {
  store: DebugModeStore;
  now?: () => number;
}): DebugMode {
  let state: TDebugModeState = OFF;
  let readAt = -Infinity;
  let reading: Promise<TDebugModeState> | null = null;
  const listeners: Array<(state: TDebugModeState) => void> = [];

  const toState = (stored: StoredDebugMode | undefined): TDebugModeState =>
    stored && stored.enabledUntil > now()
      ? {
          enabled: true,
          enabledUntil: new Date(stored.enabledUntil).toISOString(),
          enabledBy: stored.enabledBy,
          level: isDebugLogLevel(stored.level) ? stored.level : 'debug',
        }
      : OFF;

  const apply = (next: TDebugModeState) => {
    const changed =
      next.enabled !== state.enabled ||
      next.enabledUntil !== state.enabledUntil ||
      next.level !== state.level;
    state = next;
    readAt = now();
    if (changed) {
      for (const listener of listeners) {
        listener(next);
      }
    }
    return next;
  };

  /** The window can run out between reads; the cached state must not outlive it. */
  const expired = () => state.enabled && Date.parse(state.enabledUntil ?? '') <= now();

  async function getState() {
    if (now() - readAt < REFRESH_MS && !expired()) {
      return state;
    }
    if (!reading) {
      reading = store
        .get()
        .then((stored) => apply(toState(stored)))
        .catch(() => apply(expired() ? OFF : state))
        .finally(() => {
          reading = null;
        });
    }
    return reading;
  }

  return {
    getState,
    isActiveNow: () => state.enabled && !expired(),
    levelNow: () => state.level,
    async enable({ minutes, level, by }) {
      const span = clampDebugMinutes(minutes) * 60_000;
      const stored: StoredDebugMode = {
        enabledUntil: now() + span,
        enabledBy: by,
        level: isDebugLogLevel(level) ? level : 'debug',
      };
      await store.set(stored, span);
      return apply(toState(stored));
    },
    async disable() {
      await store.delete();
      return apply(OFF);
    },
    onChange(listener) {
      listeners.push(listener);
    },
  };
}
