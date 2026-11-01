import { BROWSER_END_REASONS, BROWSER_REFUSALS } from 'librechat-data-provider';
import type { TBrowserEndReason, TBrowserRefusal } from 'librechat-data-provider';
import type { Model } from 'mongoose';
import type {
  IUser,
  IBrowserSession,
  BrowserSessionListRow,
  BrowserSessionListParams,
} from '~/types';
import { isValidObjectIdString } from '~/utils/objectId';
import { buildUserSearchFilter } from '~/utils/search';

const MAX_PAGE_SIZE = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
const DOMAIN_LIMIT = 50;
const REASONS = new Set<string>([...BROWSER_REFUSALS, ...BROWSER_END_REASONS]);

const keepUntil = (from: Date, days: number) =>
  new Date(from.getTime() + Math.max(1, Math.trunc(days)) * DAY_MS);

const cleanDomains = (domains: unknown): string[] =>
  Array.isArray(domains)
    ? [...new Set(domains.filter((domain): domain is string => typeof domain === 'string'))]
        .map((domain) => domain.slice(0, 253))
        .slice(0, DOMAIN_LIMIT)
    : [];

export interface BrowserSessionMethods {
  /** Logs a browser that opened; its end is filled in later. */
  recordBrowserSessionStart(input: {
    userId: string;
    sessionId: string;
    startedAt?: Date;
    keepDays: number;
  }): Promise<void>;
  /** Fills in how an open browser ended; false when it was unknown or already ended. */
  recordBrowserSessionEnd(input: {
    sessionId: string;
    reason: TBrowserEndReason;
    endedAt?: Date;
    durationMs?: number;
    domains?: string[];
  }): Promise<boolean>;
  /** Logs a request that did not get a browser, with the user who made it. */
  recordBrowserRefusal(input: {
    userId: string;
    reason: TBrowserRefusal;
    detail?: string;
    at?: Date;
    keepDays: number;
  }): Promise<void>;
  /** Service ids of browsers the log still has open. */
  listOpenBrowserSessionIds(): Promise<string[]>;
  listBrowserSessions(
    params: BrowserSessionListParams,
  ): Promise<{ total: number; entries: BrowserSessionListRow[] }>;
}

export function createBrowserSessionMethods(
  mongoose: typeof import('mongoose'),
): BrowserSessionMethods {
  const sessions = () => mongoose.models.BrowserSession as Model<IBrowserSession>;
  const users = () => mongoose.models.User as Model<IUser>;

  async function recordBrowserSessionStart({
    userId,
    sessionId,
    startedAt = new Date(),
    keepDays,
  }: Parameters<BrowserSessionMethods['recordBrowserSessionStart']>[0]) {
    await sessions().updateOne(
      { sessionId },
      {
        $setOnInsert: {
          user: userId,
          sessionId,
          outcome: 'opened',
          startedAt,
          endedAt: null,
          domains: [],
          expiresAt: keepUntil(startedAt, keepDays),
        },
      },
      { upsert: true },
    );
  }

  async function recordBrowserSessionEnd({
    sessionId,
    reason,
    endedAt = new Date(),
    durationMs,
    domains,
  }: Parameters<BrowserSessionMethods['recordBrowserSessionEnd']>[0]) {
    const result = await sessions().updateOne(
      { sessionId, endedAt: null },
      {
        $set: {
          reason,
          endedAt,
          ...(typeof durationMs === 'number' && durationMs >= 0 && { durationMs }),
          ...(domains && { domains: cleanDomains(domains) }),
        },
      },
    );
    return result.modifiedCount > 0;
  }

  async function recordBrowserRefusal({
    userId,
    reason,
    detail,
    at = new Date(),
    keepDays,
  }: Parameters<BrowserSessionMethods['recordBrowserRefusal']>[0]) {
    await sessions().create({
      user: userId,
      outcome: 'refused',
      reason,
      ...(detail && { detail: detail.slice(0, 200) }),
      startedAt: at,
      endedAt: at,
      domains: [],
      expiresAt: keepUntil(at, keepDays),
    });
  }

  async function listOpenBrowserSessionIds() {
    const docs = await sessions()
      .find({ outcome: 'opened', endedAt: null }, 'sessionId')
      .limit(1000)
      .lean();
    return docs.map((doc) => doc.sessionId).filter((id): id is string => typeof id === 'string');
  }

  async function listBrowserSessions({
    search,
    filter,
    limit = 25,
    offset = 0,
  }: BrowserSessionListParams) {
    const pageSize = Math.min(Math.max(Math.trunc(limit) || 25, 1), MAX_PAGE_SIZE);
    const skip = Math.max(Math.trunc(offset) || 0, 0);
    const query: Record<string, unknown> = {};
    if (filter === 'refused' || filter === 'opened') {
      query.outcome = filter;
    } else if (filter && REASONS.has(filter)) {
      query.reason = filter;
    }
    const trimmed = typeof search === 'string' ? search.trim().slice(0, 200) : '';
    if (trimmed) {
      const owners: unknown[] = isValidObjectIdString(trimmed) ? [trimmed] : [];
      const userFilter = buildUserSearchFilter(trimmed, { legacyPrefix: true });
      if (userFilter) {
        const matched = await users().find(userFilter, '_id').limit(200).lean();
        owners.push(...matched.map((user) => user._id));
      }
      query.user = { $in: owners };
    }

    const [docs, total] = await Promise.all([
      sessions().find(query).sort({ startedAt: -1 }).skip(skip).limit(pageSize).lean(),
      sessions().countDocuments(query),
    ]);
    const userIds = [...new Set(docs.map((doc) => doc.user.toString()))];
    const found = userIds.length
      ? await users()
          .find({ _id: { $in: userIds } }, '_id email name')
          .lean()
      : [];
    const byId = new Map(found.map((user) => [user._id.toString(), user]));
    const entries: BrowserSessionListRow[] = docs.map((doc) => {
      const owner = byId.get(doc.user.toString());
      return {
        id: doc._id.toString(),
        user: owner
          ? {
              id: owner._id.toString(),
              ...(owner.name && { name: owner.name }),
              ...(owner.email && { email: owner.email }),
            }
          : null,
        ...(doc.sessionId && { sessionId: doc.sessionId }),
        outcome: doc.outcome,
        ...(doc.reason && { reason: doc.reason }),
        ...(doc.detail && { detail: doc.detail }),
        startedAt: doc.startedAt,
        endedAt: doc.endedAt ?? null,
        ...(typeof doc.durationMs === 'number' && { durationMs: doc.durationMs }),
        domains: doc.domains ?? [],
      };
    });
    return { total, entries };
  }

  return {
    recordBrowserSessionStart,
    recordBrowserSessionEnd,
    recordBrowserRefusal,
    listOpenBrowserSessionIds,
    listBrowserSessions,
  };
}
