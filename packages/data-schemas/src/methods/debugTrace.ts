import type { Model } from 'mongoose';
import type {
  IUser,
  IDebugTrace,
  DebugTraceAppend,
  DebugTraceDetail,
  DebugTraceListRow,
  DebugTraceListParams,
} from '~/types';
import { isValidObjectIdString } from '~/utils/objectId';
import { buildUserSearchFilter } from '~/utils/search';

const MAX_PAGE_SIZE = 100;
const HOUR_MS = 60 * 60 * 1000;
/** A trace keeps its first this-many stages and log lines; a runaway request cannot grow it further */
export const DEBUG_TRACE_MAX_STAGES = 200;
export const DEBUG_TRACE_MAX_LOGS = 500;

/** The fields a lean trace document carries */
type TraceDoc = Pick<
  IDebugTrace,
  | 'traceId'
  | 'conversationId'
  | 'endpoint'
  | 'modelId'
  | 'spec'
  | 'path'
  | 'startedAt'
  | 'status'
  | 'errorCount'
  | 'warnCount'
> & { user?: { toString(): string } | null };

const short = (value: unknown, max: number) =>
  typeof value === 'string' && value ? value.slice(0, max) : undefined;

export interface DebugTraceMethods {
  /** Adds a recorder's stages and log lines to its trace, creating the trace on the first call. */
  appendDebugTrace(input: DebugTraceAppend): Promise<void>;
  listDebugTraces(
    params: DebugTraceListParams,
  ): Promise<{ total: number; entries: DebugTraceListRow[] }>;
  getDebugTrace(traceId: string): Promise<DebugTraceDetail | null>;
  /** Removes every trace; returns how many there were. */
  clearDebugTraces(): Promise<number>;
}

export function createDebugTraceMethods(mongoose: typeof import('mongoose')): DebugTraceMethods {
  const traces = () => mongoose.models.DebugTrace as Model<IDebugTrace>;
  const users = () => mongoose.models.User as Model<IUser>;

  async function appendDebugTrace(input: DebugTraceAppend) {
    const set: Record<string, unknown> = {};
    const conversationId = short(input.conversationId, 100);
    if (conversationId) {
      set.conversationId = conversationId;
    }
    if (typeof input.status === 'number') {
      set.status = input.status;
    }
    const model = short(input.model, 200);
    if (model) {
      set.modelId = model;
    }
    const update: Record<string, unknown> = {
      $setOnInsert: {
        traceId: input.traceId,
        user: input.userId && isValidObjectIdString(input.userId) ? input.userId : null,
        ...(short(input.endpoint, 100) && { endpoint: short(input.endpoint, 100) }),
        ...(short(input.spec, 200) && { spec: short(input.spec, 200) }),
        ...(short(input.path, 300) && { path: short(input.path, 300) }),
        startedAt: input.startedAt,
        expiresAt: new Date(input.startedAt.getTime() + Math.max(1, input.keepHours) * HOUR_MS),
      },
      $inc: { errorCount: input.errors ?? 0, warnCount: input.warnings ?? 0 },
    };
    if (Object.keys(set).length > 0) {
      update.$set = set;
    }
    const push: Record<string, unknown> = {};
    if (input.stages?.length) {
      push.stages = { $each: input.stages, $slice: DEBUG_TRACE_MAX_STAGES };
    }
    if (input.logs?.length) {
      push.logs = { $each: input.logs, $slice: DEBUG_TRACE_MAX_LOGS };
    }
    if (Object.keys(push).length > 0) {
      update.$push = push;
    }
    await traces().updateOne({ traceId: input.traceId }, update, { upsert: true });
  }

  async function listDebugTraces({
    search,
    problems,
    limit = 25,
    offset = 0,
  }: DebugTraceListParams) {
    const pageSize = Math.min(Math.max(1, Math.trunc(limit)), MAX_PAGE_SIZE);
    const skip = Math.max(0, Math.trunc(offset));
    const query: Record<string, unknown> = {};
    if (problems) {
      query.$or = [{ errorCount: { $gt: 0 } }, { warnCount: { $gt: 0 } }];
    }
    const trimmed = typeof search === 'string' ? search.trim().slice(0, 200) : '';
    if (trimmed) {
      const owners: unknown[] = isValidObjectIdString(trimmed) ? [trimmed] : [];
      const userFilter = buildUserSearchFilter(trimmed, { legacyPrefix: true });
      if (userFilter) {
        const matched = await users().find(userFilter, '_id').limit(200).lean();
        owners.push(...matched.map((user) => user._id));
      }
      const bySearch = [{ user: { $in: owners } }, { conversationId: trimmed }];
      if (query.$or) {
        query.$and = [{ $or: query.$or }, { $or: bySearch }];
        delete query.$or;
      } else {
        query.$or = bySearch;
      }
    }

    const [docs, total] = await Promise.all([
      traces()
        .find(query, { logs: 0, stages: 0 })
        .sort({ startedAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean(),
      traces().countDocuments(query),
    ]);
    /** Counts without loading the arrays: one small aggregate over the page's ids */
    const counts = docs.length
      ? await traces().aggregate<{ _id: unknown; stageCount: number; logCount: number }>([
          { $match: { _id: { $in: docs.map((doc) => doc._id) } } },
          {
            $project: {
              stageCount: { $size: { $ifNull: ['$stages', []] } },
              logCount: { $size: { $ifNull: ['$logs', []] } },
            },
          },
        ])
      : [];
    const countById = new Map(counts.map((row) => [String(row._id), row]));
    const byId = await findOwners(docs);
    const entries = docs.map((doc) => {
      const count = countById.get(doc._id.toString());
      return toRow(doc, byId, count?.stageCount ?? 0, count?.logCount ?? 0);
    });
    return { total, entries };
  }

  async function getDebugTrace(traceId: string): Promise<DebugTraceDetail | null> {
    if (typeof traceId !== 'string' || !traceId || traceId.length > 100) {
      return null;
    }
    const doc = await traces().findOne({ traceId }).lean();
    if (!doc) {
      return null;
    }
    const byId = await findOwners([doc]);
    const stages = doc.stages ?? [];
    const logs = doc.logs ?? [];
    return { ...toRow(doc, byId, stages.length, logs.length), stages, logs };
  }

  async function clearDebugTraces() {
    const result = await traces().deleteMany({});
    return result.deletedCount ?? 0;
  }

  async function findOwners(docs: Array<Pick<TraceDoc, 'user'>>) {
    const userIds = [
      ...new Set(docs.map((doc) => doc.user?.toString()).filter((id): id is string => !!id)),
    ];
    const found = userIds.length
      ? await users()
          .find({ _id: { $in: userIds } }, '_id email name')
          .lean()
      : [];
    return new Map(found.map((user) => [user._id.toString(), user]));
  }

  function toRow(
    doc: TraceDoc,
    byId: Map<string, Pick<IUser, '_id' | 'name' | 'email'>>,
    stageCount: number,
    logCount: number,
  ): DebugTraceListRow {
    const owner = doc.user ? byId.get(doc.user.toString()) : undefined;
    return {
      id: doc.traceId,
      user: owner
        ? {
            id: owner._id.toString(),
            ...(owner.name && { name: owner.name }),
            ...(owner.email && { email: owner.email }),
          }
        : null,
      ...(doc.conversationId && { conversationId: doc.conversationId }),
      ...(doc.endpoint && { endpoint: doc.endpoint }),
      ...(doc.modelId && { model: doc.modelId }),
      ...(doc.spec && { spec: doc.spec }),
      ...(doc.path && { path: doc.path }),
      startedAt: doc.startedAt,
      ...(typeof doc.status === 'number' && { status: doc.status }),
      stageCount,
      logCount,
      errorCount: doc.errorCount ?? 0,
      warnCount: doc.warnCount ?? 0,
    };
  }

  return { appendDebugTrace, listDebugTraces, getDebugTrace, clearDebugTraces };
}
