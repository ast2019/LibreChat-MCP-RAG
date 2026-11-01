import type { TBrowserEndReason, TBrowserRefusal } from 'librechat-data-provider';
import type { Document, Types } from 'mongoose';

/**
 * One line of the admin's «لاگ مرورگر»: a browser that opened (with how and when it ended) or a
 * request that was refused. Holds who, when, how long and which sites, never page content,
 * passwords or form data.
 */
export interface IBrowserSession extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  /** The browser service's id; absent on a refusal */
  sessionId?: string;
  outcome: 'opened' | 'refused';
  /** Why it ended, or why it was refused; absent while the browser is open */
  reason?: TBrowserRefusal | TBrowserEndReason;
  /** A short technical cause, such as `ram` or `cpu` for a capacity refusal */
  detail?: string;
  startedAt: Date;
  endedAt?: Date | null;
  durationMs?: number;
  /** Host names the browser opened, in order */
  domains: string[];
  /** When the entry leaves the log (TTL) */
  expiresAt: Date;
  tenantId?: string;
}

export interface BrowserSessionListParams {
  search?: string;
  /** One reason, every refusal (`refused`) or every browser that opened (`opened`) */
  filter?: string;
  limit?: number;
  offset?: number;
}

export interface BrowserSessionListRow {
  id: string;
  user: { id: string; name?: string; email?: string } | null;
  sessionId?: string;
  outcome: 'opened' | 'refused';
  reason?: TBrowserRefusal | TBrowserEndReason;
  detail?: string;
  startedAt: Date;
  endedAt?: Date | null;
  durationMs?: number;
  domains: string[];
}
