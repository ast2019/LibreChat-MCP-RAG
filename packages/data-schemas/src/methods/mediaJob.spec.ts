import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { MediaJobMethods } from './mediaJob';
import { createMediaJobMethods } from './mediaJob';
import { createMediaJobModel } from '~/models/mediaJob';

let server: MongoMemoryServer;
let methods: MediaJobMethods;
const owner = new mongoose.Types.ObjectId().toString();

const base = () => ({
  user: owner,
  kind: 'video' as const,
  provider: 'openrouter' as const,
  providerJobId: 'or-1',
  providerModel: 'google/veo',
  endpoint: 'OpenRouter',
  context: 'video_generation',
  fallbackUsd: 1,
  priceMultiplier: 1.3,
  pollIntervalMs: 10_000,
  deadline: new Date(Date.now() + 600_000),
});

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri());
  createMediaJobModel(mongoose);
  methods = createMediaJobMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});

beforeEach(async () => {
  await mongoose.models.MediaJob.deleteMany({});
});

describe('media job methods', () => {
  it('shows a job only to its owner', async () => {
    const job = await methods.createMediaJob(base());
    expect(job.status).toBe('pending');
    expect(await methods.findMediaJobForUser(job.id, owner)).toMatchObject({ id: job.id });
    const stranger = new mongoose.Types.ObjectId().toString();
    expect(await methods.findMediaJobForUser(job.id, stranger)).toBeNull();
    expect(await methods.findMediaJobForUser('not-an-id', owner)).toBeNull();
  });

  it('leases a due job once, until it is updated or the lease runs out', async () => {
    const job = await methods.createMediaJob({ ...base(), nextPollAt: new Date(Date.now() - 1) });
    const now = new Date();
    expect(await methods.claimDueMediaJobs({ now, leaseMs: 60_000, limit: 5 })).toHaveLength(1);
    expect(await methods.claimDueMediaJobs({ now, leaseMs: 60_000, limit: 5 })).toHaveLength(0);
    const later = new Date(now.getTime() + 61_000);
    expect(await methods.claimDueMediaJobs({ now: later, leaseMs: 60_000, limit: 5 })).toHaveLength(
      1,
    );

    await methods.updateMediaJob(job.id, { status: 'completed', filepath: '/images/x.mp4' });
    expect(
      await methods.claimDueMediaJobs({
        now: new Date(later.getTime() + 61_000),
        leaseMs: 1,
        limit: 5,
      }),
    ).toHaveLength(0);
  });

  it('completes a job only once, so only one step charges it', async () => {
    const job = await methods.createMediaJob(base());
    const update = { status: 'completed' as const, chargedCredits: 1_300_000 };
    expect(await methods.completeMediaJob(job.id, update)).toMatchObject({
      status: 'completed',
      chargedCredits: 1_300_000,
    });
    expect(await methods.completeMediaJob(job.id, update)).toBeNull();
    expect(await methods.completeMediaJob('not-an-id', update)).toBeNull();
  });

  it('does not claim a job before its next poll', async () => {
    await methods.createMediaJob(base());
    expect(await methods.claimDueMediaJobs({ now: new Date(), leaseMs: 1, limit: 5 })).toHaveLength(
      0,
    );
  });
});

describe('clip jobs', () => {
  const clip = () => ({
    ...base(),
    kind: 'clip' as const,
    provider: 'remotion' as const,
    providerJobId: 'pending',
    providerModel: 'remotion',
    endpoint: 'remotion',
    context: 'clip_generation',
    fallbackUsd: 0,
    priceMultiplier: 1,
    pollIntervalMs: 3_000,
    nextPollAt: new Date(Date.now() - 1000),
    progress: 0,
    stage: 'queued',
    payload: { request: { storyboard: { title: 'x' } } },
  });

  it('stores progress, stage and payload, and claims by kind', async () => {
    const created = await methods.createMediaJob(clip());
    expect(created).toMatchObject({ kind: 'clip', stage: 'queued', progress: 0 });
    expect(created.payload).toEqual({ request: { storyboard: { title: 'x' } } });
    const videosOnly = await methods.claimDueMediaJobs({
      now: new Date(),
      leaseMs: 60_000,
      limit: 10,
      kinds: ['video'],
    });
    expect(videosOnly.some((job) => job.id === created.id)).toBe(false);
    const clips = await methods.claimDueMediaJobs({
      now: new Date(),
      leaseMs: 60_000,
      limit: 10,
      kinds: ['clip'],
    });
    expect(clips.map((job) => job.id)).toContain(created.id);
    const updated = await methods.updateMediaJob(created.id, {
      stage: 'render',
      progress: 0.5,
      workerJobId: 'w1',
    });
    expect(updated).toMatchObject({ stage: 'render', progress: 0.5, workerJobId: 'w1' });
  });

  it('counts pending clips per user and lets only the owner request a cancel', async () => {
    const user = new mongoose.Types.ObjectId().toString();
    const job = await methods.createMediaJob({ ...clip(), user });
    expect(await methods.countPendingMediaJobs(user, 'clip')).toBe(1);
    expect(await methods.countPendingMediaJobs(user, 'video')).toBe(0);
    expect(await methods.requestMediaJobCancel(job.id, owner)).toBeNull();
    const asked = await methods.requestMediaJobCancel(job.id, user);
    expect(asked?.cancelRequested).toBe(true);
    await methods.updateMediaJob(job.id, { status: 'failed', errorCode: 'cancelled' });
    expect(await methods.countPendingMediaJobs(user, 'clip')).toBe(0);
    const again = await methods.requestMediaJobCancel(job.id, user);
    expect(again?.status).toBe('failed');
  });

  it('a cancel request on a video job is refused and does not move its next poll', async () => {
    const user = new mongoose.Types.ObjectId().toString();
    const nextPollAt = new Date(Date.now() + 120_000);
    const video = await methods.createMediaJob({ ...base(), user, nextPollAt });
    expect(await methods.requestMediaJobCancel(video.id, user)).toBeNull();
    const stored = await methods.findMediaJobForUser(video.id, user);
    expect(stored?.cancelRequested).toBeUndefined();
    expect(new Date(stored!.nextPollAt).getTime()).toBe(nextPollAt.getTime());
  });

  it('updates the payload and removes it when the update sets it to null', async () => {
    const job = await methods.createMediaJob(clip());
    const next = { request: { storyboard: { title: 'y' } }, aiCredits: 5 };
    expect((await methods.updateMediaJob(job.id, { payload: next }))?.payload).toEqual(next);
    const done = await methods.updateMediaJob(job.id, { status: 'completed', payload: null });
    expect(done?.payload).toBeUndefined();
    const raw = await mongoose.models.MediaJob.findById(job.id).lean<Record<string, unknown>>();
    expect(raw && 'payload' in raw).toBe(false);
  });
});
