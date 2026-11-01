import { z } from 'zod';

/**
 * `browser` in librechat.yaml: the agent browser (experimental). Limits are checked by the
 * browser service before each launch; access comes from packs, user overrides and the admin role.
 */
export const browserConfigSchema = z.object({
  /** Off hides the browser everywhere, even when the browser service is running */
  enabled: z.boolean().default(true),
  /** Browsers open at once on the whole server */
  maxSessions: z.number().int().min(1).max(100).default(10),
  /** Minutes without a step before a browser closes itself */
  idleMinutes: z.number().min(0.5).max(60).default(3),
  /** The longest a browser stays open, in minutes */
  maxMinutes: z.number().int().min(1).max(120).default(20),
  /** New browsers are refused at or above these percentages */
  capacity: z
    .object({
      /** Memory in use, on the host and in the browser container */
      ram: z.number().min(10).max(100).default(85),
      /** CPU in use on the host, averaged over the last minute */
      cpu: z.number().min(10).max(100).default(90),
    })
    .default({}),
  /** Days the browser log keeps an entry */
  logDays: z.number().int().min(1).max(365).default(90),
});

export type TBrowserConfig = z.infer<typeof browserConfigSchema>;

/** The admin view's state: room for more browsers, getting close, or refusing new ones. */
export type TServerLoadState = 'normal' | 'warning' | 'full';

/** Why a browser was refused or did not open. */
export const BROWSER_REFUSALS = [
  'capacity',
  'server_full',
  'user_limit',
  'not_allowed',
  'launch_failed',
  'unavailable',
] as const;

export type TBrowserRefusal = (typeof BROWSER_REFUSALS)[number];

/** Why an open browser ended. */
export const BROWSER_END_REASONS = [
  'closed',
  'idle',
  'timeout',
  'admin',
  'crashed',
  'shutdown',
  'lost',
] as const;

export type TBrowserEndReason = (typeof BROWSER_END_REASONS)[number];

/** Log filters: one reason, or every refusal, or every session that opened. */
export type TBrowserLogFilter = TBrowserRefusal | TBrowserEndReason | 'refused' | 'opened';

export type TServerLoadPoint = {
  at: number;
  ram: number | null;
  cpu: number | null;
  container: number | null;
  sessions: number;
};

export type TAdminBrowserSession = {
  id: string;
  user: { id: string; name?: string; email?: string } | null;
  startedAt: number;
  lastActiveAt: number;
  domains: string[];
};

export type TAdminServerStatus = {
  /** The browser is on in the config and the service answered */
  enabled: boolean;
  /** The service answered; false while it is down, not deployed or misconfigured */
  reachable: boolean;
  state: TServerLoadState;
  /** What blocks new browsers right now, if anything */
  blocking: 'ram' | 'cpu' | 'server_full' | null;
  ram: { percent: number; used: number; total: number } | null;
  cpu: number | null;
  container: { percent: number; used: number; limit: number } | null;
  limits: {
    ram: number;
    cpu: number;
    maxSessions: number;
    idleMinutes: number;
    maxMinutes: number;
  };
  sessions: TAdminBrowserSession[];
  history: TServerLoadPoint[];
  checkedAt: number;
};

export type TAdminBrowserLogEntry = {
  id: string;
  user: { id: string; name?: string; email?: string } | null;
  sessionId?: string;
  outcome: 'opened' | 'refused';
  reason?: TBrowserRefusal | TBrowserEndReason;
  detail?: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  domains: string[];
};

export type TAdminBrowserLogParams = {
  search?: string;
  filter?: TBrowserLogFilter;
  limit?: number;
  offset?: number;
};

export type TAdminBrowserLogResponse = {
  total: number;
  limit: number;
  offset: number;
  entries: TAdminBrowserLogEntry[];
};
