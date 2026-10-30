import type { Model } from 'mongoose';
import type { IMediaJob, MediaJobRecord, MediaJobUpdate, MediaJobCreateData } from '~/types';
import { isValidObjectIdString } from '~/utils/objectId';

export interface MediaJobMethods {
  createMediaJob: (data: MediaJobCreateData) => Promise<MediaJobRecord>;
  /** The job when it belongs to `userId`; null otherwise, so ids cannot be probed. */
  findMediaJobForUser: (jobId: string, userId: string) => Promise<MediaJobRecord | null>;
  /**
   * Leases up to `limit` pending jobs whose poll is due, one at a time, so two workers never poll
   * the same job; a lease that outlives a crashed worker expires on its own.
   */
  claimDueMediaJobs: (params: {
    now: Date;
    leaseMs: number;
    limit: number;
  }) => Promise<MediaJobRecord[]>;
  /** Applies the update and releases the lease. */
  updateMediaJob: (jobId: string, update: MediaJobUpdate) => Promise<MediaJobRecord | null>;
}

function toRecord(doc: IMediaJob | (Record<string, unknown> & { _id: unknown })): MediaJobRecord {
  const raw = doc as unknown as Record<string, unknown> & { _id: { toString(): string } };
  const { _id, user, __v: _v, leaseUntil: _lease, ...rest } = raw;
  return {
    ...(rest as Omit<MediaJobRecord, 'id' | 'user'>),
    id: _id.toString(),
    user: String(user),
  };
}

export function createMediaJobMethods(mongoose: typeof import('mongoose')): MediaJobMethods {
  const jobs = () => mongoose.models.MediaJob as Model<IMediaJob>;

  async function createMediaJob(data: MediaJobCreateData): Promise<MediaJobRecord> {
    const doc = await jobs().create({
      ...data,
      status: 'pending',
      nextPollAt: data.nextPollAt ?? new Date(Date.now() + data.pollIntervalMs),
    });
    return toRecord(doc.toObject() as IMediaJob);
  }

  async function findMediaJobForUser(
    jobId: string,
    userId: string,
  ): Promise<MediaJobRecord | null> {
    if (!isValidObjectIdString(jobId) || !isValidObjectIdString(userId)) {
      return null;
    }
    const doc = await jobs().findOne({ _id: jobId, user: userId }).lean();
    return doc ? toRecord(doc as never) : null;
  }

  async function claimDueMediaJobs({
    now,
    leaseMs,
    limit,
  }: {
    now: Date;
    leaseMs: number;
    limit: number;
  }): Promise<MediaJobRecord[]> {
    const claimed: MediaJobRecord[] = [];
    for (let i = 0; i < limit; i++) {
      const doc = await jobs()
        .findOneAndUpdate(
          {
            status: 'pending',
            nextPollAt: { $lte: now },
            $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }],
          },
          { $set: { leaseUntil: new Date(now.getTime() + leaseMs) } },
          { new: true, sort: { nextPollAt: 1 } },
        )
        .lean();
      if (!doc) {
        break;
      }
      claimed.push(toRecord(doc as never));
    }
    return claimed;
  }

  async function updateMediaJob(
    jobId: string,
    update: MediaJobUpdate,
  ): Promise<MediaJobRecord | null> {
    const doc = await jobs()
      .findOneAndUpdate({ _id: jobId }, { $set: { ...update, leaseUntil: null } }, { new: true })
      .lean();
    return doc ? toRecord(doc as never) : null;
  }

  return { createMediaJob, findMediaJobForUser, claimDueMediaJobs, updateMediaJob };
}
