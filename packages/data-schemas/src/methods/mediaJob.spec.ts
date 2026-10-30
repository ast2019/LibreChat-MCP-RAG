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

  it('does not claim a job before its next poll', async () => {
    await methods.createMediaJob(base());
    expect(await methods.claimDueMediaJobs({ now: new Date(), leaseMs: 1, limit: 5 })).toHaveLength(
      0,
    );
  });
});
