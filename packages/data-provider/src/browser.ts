import { z } from 'zod';

/** The agent browser's tools, as the model calls them (experimental). */
export enum BrowserTools {
  /** Opens an address, starting the conversation's browser when none is open */
  open = 'browser_open',
  /** The page as text with element refs */
  read = 'browser_read',
  /** One step on the page: click, type, select, a key, scroll, back or wait */
  act = 'browser_act',
  /** Gives the browser to the user for a sign-in, a CAPTCHA or a payment */
  handoff = 'browser_handoff',
  /** Closes the browser; nothing from it is kept */
  close = 'browser_close',
}

export const BROWSER_TOOL_NAMES: readonly string[] = Object.values(BrowserTools);

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
  /** Characters of page text the model gets after each step */
  snapshotChars: z.number().int().min(2_000).max(60_000).default(12_000),
  /** Most frames a second the live view sends */
  liveFps: z.number().int().min(1).max(10).default(3),
  /** JPEG quality of the live view's frames */
  liveQuality: z.number().int().min(20).max(90).default(50),
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
  /** The user opened a browser in another conversation and this idle one made room */
  'replaced',
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

/** Who drives the browser: the model's steps, or the user in the live view. */
export type TBrowserControl = 'model' | 'user';

/** Why the model gave the browser to the user. */
export const BROWSER_HANDOFF_REASONS = ['login', 'captcha', 'payment', 'confirm', 'other'] as const;

export type TBrowserHandoffReason = (typeof BROWSER_HANDOFF_REASONS)[number];

export type TBrowserHandoff = { reason: TBrowserHandoffReason; message?: string };

/** The user's browser in one conversation, as the live view shows it. */
export type TBrowserSessionView = {
  id: string;
  control: TBrowserControl;
  handoff: TBrowserHandoff | null;
  url: string;
  title: string;
  startedAt: number;
  lastActiveAt: number;
  idleMs: number;
  maxMs: number;
};

export type TBrowserSessionResponse = { session: TBrowserSessionView | null };

/** Keys the live view sends on its own buttons. */
export const BROWSER_INPUT_KEYS = [
  'Enter',
  'Tab',
  'Escape',
  'Backspace',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PageUp',
  'PageDown',
] as const;

/** What the user does in the live view; coordinates are CSS pixels of the page's viewport. */
export type TBrowserInput =
  | { type: 'click'; x: number; y: number }
  | { type: 'type'; text: string }
  | { type: 'key'; key: (typeof BROWSER_INPUT_KEYS)[number] }
  | { type: 'scroll'; dy: number }
  | { type: 'back' };

export type TBrowserInputResult = {
  url: string;
  title: string;
  /** The field the click focused, so the live view can hide what is typed into a password */
  focus: 'password' | 'text' | null;
};

/** One frame of the live view: a JPEG and the viewport it shows. */
export type TBrowserFrame = { data: string; width: number; height: number };

/** The composer offers the browser: it is on in the config and the service is set up. */
export type TBrowserStartupConfig = { enabled: boolean };
