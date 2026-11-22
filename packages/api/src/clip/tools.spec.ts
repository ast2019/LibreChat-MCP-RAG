import { ClipTools } from 'librechat-data-provider';
import type { MediaJobCreateData, MediaJobRecord } from '@librechat/data-schemas';
import type { ClipToolDeps } from './tools';
import { clearClipEvents, getClipEvents } from './diagnostics';
import { createClipTools } from './tools';

const ENV = { REMOTION_SERVICE_URL: 'http://remotion:3200', REMOTION_SERVICE_TOKEN: 't'.repeat(40) };
const input = {
  title: 'Energy',
  scenes: [
    { type: 'hook', duration_sec: 3, headline: 'SECRET-HEADLINE' },
    { type: 'stat', duration_sec: 3, value: 30, suffix: '%', label: 'renewable' },
  ],
  audio: { mode: 'none' },
};

const SCOPE = '__librechat_tool_approval_execution_scope';
const turn = (responseMessageId: string) => ({
  configurable: { thread_id: 'convo-1', [SCOPE]: JSON.stringify([responseMessageId, 1]) },
});

function build(
  overrides: Partial<ClipToolDeps> = {},
  userId = '64b000000000000000000001',
  clipTools: Record<string, unknown> = {},
) {
  let n = 0;
  const createMediaJob = jest.fn(
    async (data: MediaJobCreateData) =>
      ({ ...data, id: `65c00000000000000000000${n++}`, status: 'pending', nextPollAt: new Date() }) as MediaJobRecord,
  );
  const deps: ClipToolDeps = {
    createMediaJob,
    countPendingMediaJobs: jest.fn(async () => 0),
    loadImage: jest.fn(async () => ({ buffer: Buffer.from('png'), type: 'image/png' })),
    loadAudio: jest.fn(async () => null),
    env: ENV,
    ...overrides,
  };
  const req = { user: { id: userId }, config: { config: { clipTools } }, body: {} } as never;
  const [clip] = createClipTools({ req, toolNames: [ClipTools.clip] }, deps);
  return { clip, deps, createMediaJob };
}

const run = async (clip: unknown, payload: unknown = input, config?: unknown): Promise<string> => {
  const out = await (clip as { invoke: (i: unknown, c?: unknown) => Promise<unknown> }).invoke(payload, config);
  return typeof out === 'string' ? out : JSON.stringify(out);
};

describe('create_remotion_clip (background job)', () => {
  beforeEach(() => clearClipEvents());

  it('records a clip job and answers at once with the job card link', async () => {
    const { clip, createMediaJob } = build();
    const out = await run(clip);
    expect(createMediaJob).toHaveBeenCalledTimes(1);
    const data = createMediaJob.mock.calls[0][0];
    expect(data).toMatchObject({ kind: 'clip', provider: 'remotion', stage: 'queued', progress: 0, label: '6s' });
    const payload = data.payload as { request: { storyboard: { scenes: unknown[] } }; renderTimeoutMs: number; maxDurationSec: number };
    expect(payload.request.storyboard.scenes).toHaveLength(2);
    expect(payload.renderTimeoutMs).toBe(600_000);
    expect(payload.maxDurationSec).toBe(90);
    /** The deadline covers the queue wait and the render budget, so api and worker agree. */
    expect(new Date(data.deadline).getTime() - Date.now()).toBeGreaterThan((900 + 600) * 1000);
    expect(out).toContain('/api/media/jobs/65c000000000000000000000');
    expect(out).toContain('do not retry');
    expect(JSON.stringify(getClipEvents())).not.toContain('SECRET-HEADLINE');
  });

  it('starts one clip per turn: a second call in the same request is refused', async () => {
    const { clip, createMediaJob } = build();
    await run(clip);
    const second = await run(clip);
    expect(createMediaJob).toHaveBeenCalledTimes(1);
    expect(second).toContain('Only one clip is built per turn');
    /** The refusal names no job link, so the chat draws no second card. */
    expect(second).not.toContain('/api/media/jobs/');
  });

  it('one clip per turn holds when the tools are built again for a later tool batch', async () => {
    const userId = '64b000000000000000000011';
    const firstBatch = build({}, userId);
    const secondBatch = build({ countPendingMediaJobs: jest.fn(async () => 0) }, userId, { maxJobsPerUser: 3 });
    await run(firstBatch.clip, input, turn('response-a'));
    const again = await run(secondBatch.clip, input, turn('response-a'));
    expect(again).toContain('Only one clip is built per turn');
    expect(secondBatch.createMediaJob).not.toHaveBeenCalled();
    /** The next turn may start a clip. */
    const next = build({}, userId, { maxJobsPerUser: 3 });
    await run(next.clip, input, turn('response-b'));
    expect(next.createMediaJob).toHaveBeenCalledTimes(1);
  });

  it('refuses audio the worker cannot read at call time', async () => {
    const { clip, createMediaJob } = build({ loadAudio: jest.fn(async () => ({ buffer: Buffer.from('fLaC'), type: 'audio/flac' })) });
    const out = await run(clip, { ...input, audio: { mode: 'upload', file_id: 'audio-123456' } });
    expect(out).toContain('cannot read');
    expect(createMediaJob).not.toHaveBeenCalled();
  });

  it('refuses images and audio over the asset limit with a size the model can act on', async () => {
    const { clip, createMediaJob } = build(
      { loadImage: jest.fn(async () => ({ buffer: Buffer.alloc(3 * 1024 * 1024), type: 'image/png' })) },
      '64b000000000000000000012',
      { maxAssetMb: 2 },
    );
    const out = await run(clip, {
      title: 'x',
      scenes: [{ type: 'image', duration_sec: 3, image: { source: 'file', file_id: 'big-123456' } }],
    });
    expect(out).toContain('over the 2 MB');
    expect(out).toContain('fewer or smaller images');
    expect(createMediaJob).not.toHaveBeenCalled();
  });

  it('a preview uses the configured timeout and still count', async () => {
    const fetchImpl = jest.fn(async () => new Response(JSON.stringify({ ok: true, stills: [], warnings: [] }), { status: 200 }));
    const { clip } = build({ fetch: fetchImpl as never }, '64b000000000000000000013', { previewTimeoutSec: 45, previewStills: 3 });
    await run(clip, { ...input, preview: true });
    const sent = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body) as { timeoutMs: number; stills: number };
    expect(sent).toMatchObject({ timeoutMs: 45_000, stills: 3 });
  });

  it('two parallel calls for one user start a single job', async () => {
    let releaseCount: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseCount = resolve;
    });
    const userId = '64b000000000000000000002';
    const a = build({ countPendingMediaJobs: jest.fn(async () => (await gate, 0)) }, userId);
    const b = build({}, userId);
    const first = run(a.clip);
    const second = await run(b.clip);
    releaseCount();
    await first;
    expect(second).toContain('being started right now');
    expect(second).toContain('Do not call create_remotion_clip again');
    expect(a.createMediaJob).toHaveBeenCalledTimes(1);
    expect(b.createMediaJob).not.toHaveBeenCalled();
  });

  it('refuses while the user already has a clip rendering', async () => {
    const { clip, createMediaJob } = build({ countPendingMediaJobs: jest.fn(async () => 1) });
    const out = await run(clip);
    expect(createMediaJob).not.toHaveBeenCalled();
    expect(out).toContain('already has 1 clip being built');
    expect(out).toContain('ask whether to try again');
  });

  it('returns every invalid field to the model and starts nothing', async () => {
    const { clip, createMediaJob } = build();
    const out = await run(clip, { title: 'x', scenes: [{ type: 'chart', duration_sec: 3, data: [{ label: 'a' }] }] });
    expect(out).toContain('the storyboard is invalid');
    expect(out).toContain('scenes[0].data: must have 2-8 items');
    expect(createMediaJob).not.toHaveBeenCalled();
    expect(getClipEvents()[0]).toMatchObject({ event: 'tool.rejected' });
  });

  it('checks that file images exist before starting', async () => {
    const { clip, createMediaJob } = build({ loadImage: jest.fn(async () => null) });
    const out = await run(clip, {
      title: 'x',
      scenes: [{ type: 'image', duration_sec: 3, image: { source: 'file', file_id: 'missing-123' } }],
    });
    expect(out).toContain('missing-123 was not found');
    expect(createMediaJob).not.toHaveBeenCalled();
  });

  it('refuses stock photos without a Pexels key', async () => {
    const { clip } = build();
    const out = await run(clip, {
      title: 'x',
      scenes: [{ type: 'image', duration_sec: 3, image: { source: 'stock', query: 'solar farm' } }],
    });
    expect(out).toContain('stock photos are off');
  });

  it('is unavailable without the worker env', async () => {
    const { clip } = build({ env: {} });
    expect(await run(clip)).toContain('not available');
  });
});
