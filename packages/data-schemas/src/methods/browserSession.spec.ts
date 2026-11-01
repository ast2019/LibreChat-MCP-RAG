import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createBrowserSessionMethods } from './browserSession';
import { createModels } from '~/models';

let server: MongoMemoryServer;
let methods: ReturnType<typeof createBrowserSessionMethods>;
let userA: mongoose.Types.ObjectId;
let userB: mongoose.Types.ObjectId;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri());
  createModels(mongoose);
  methods = createBrowserSessionMethods(mongoose);
  await mongoose.models.BrowserSession.syncIndexes();
  const users = await mongoose.models.User.create([
    { name: 'Sara Ahmadi', email: 'sara@example.com', provider: 'local' },
    { name: 'Ali', email: 'ali@example.com', provider: 'local' },
  ]);
  userA = users[0]._id;
  userB = users[1]._id;
});

afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});

beforeEach(async () => {
  await mongoose.models.BrowserSession.deleteMany({});
});

describe('browser session log', () => {
  it('records a start once and its end once, with the sites it opened', async () => {
    const startedAt = new Date('2026-11-01T08:00:00Z');
    await methods.recordBrowserSessionStart({
      userId: userA.toString(),
      sessionId: 's1',
      startedAt,
      keepDays: 90,
    });
    await methods.recordBrowserSessionStart({
      userId: userA.toString(),
      sessionId: 's1',
      keepDays: 90,
    });
    expect(await methods.listOpenBrowserSessionIds()).toEqual(['s1']);

    const ended = await methods.recordBrowserSessionEnd({
      sessionId: 's1',
      reason: 'idle',
      endedAt: new Date('2026-11-01T08:04:00Z'),
      durationMs: 240_000,
      domains: ['divar.ir', 'divar.ir', 'www.digikala.com'],
    });
    expect(ended).toBe(true);
    /* A second report of the same end (sync after a force-close) changes nothing. */
    expect(await methods.recordBrowserSessionEnd({ sessionId: 's1', reason: 'lost' })).toBe(false);
    expect(await methods.listOpenBrowserSessionIds()).toEqual([]);

    const [doc] = await mongoose.models.BrowserSession.find({}).lean();
    expect(doc).toMatchObject({
      outcome: 'opened',
      reason: 'idle',
      durationMs: 240_000,
      domains: ['divar.ir', 'www.digikala.com'],
    });
    expect(doc.expiresAt.getTime() - startedAt.getTime()).toBe(90 * 24 * 60 * 60 * 1000);
  });

  it('lists newest first with the owner, filtered by user and by reason', async () => {
    await methods.recordBrowserRefusal({
      userId: userA.toString(),
      reason: 'capacity',
      detail: 'ram',
      at: new Date('2026-11-01T09:00:00Z'),
      keepDays: 90,
    });
    await methods.recordBrowserRefusal({
      userId: userB.toString(),
      reason: 'user_limit',
      at: new Date('2026-11-01T10:00:00Z'),
      keepDays: 90,
    });
    await methods.recordBrowserSessionStart({
      userId: userB.toString(),
      sessionId: 's2',
      startedAt: new Date('2026-11-01T08:00:00Z'),
      keepDays: 90,
    });

    const all = await methods.listBrowserSessions({});
    expect(all.total).toBe(3);
    expect(all.entries.map((entry) => entry.reason ?? 'open')).toEqual([
      'user_limit',
      'capacity',
      'open',
    ]);
    expect(all.entries[1]).toMatchObject({
      user: { id: userA.toString(), name: 'Sara Ahmadi', email: 'sara@example.com' },
      outcome: 'refused',
      detail: 'ram',
    });

    expect((await methods.listBrowserSessions({ filter: 'refused' })).total).toBe(2);
    expect((await methods.listBrowserSessions({ filter: 'opened' })).total).toBe(1);
    expect((await methods.listBrowserSessions({ filter: 'capacity' })).entries).toHaveLength(1);
    const bySara = await methods.listBrowserSessions({ search: 'sara' });
    expect(bySara.entries.map((entry) => entry.user?.id)).toEqual([userA.toString()]);
    expect((await methods.listBrowserSessions({ search: 'nobody-here' })).total).toBe(0);
  });
});
