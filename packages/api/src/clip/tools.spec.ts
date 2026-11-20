import { ClipTools } from 'librechat-data-provider';
import { createClipTools } from './tools';
import { clearClipEvents, getClipEvents } from './diagnostics';
import type { ClipToolDeps } from './tools';

const OLD_ENV = process.env;
const input = {
  title: 'Demo',
  scenes: [{ type: 'title', duration_sec: 3, heading: 'SECRET-HEADING' }],
  audio: { mode: 'none' },
};

function build(fetchImpl: typeof fetch) {
  const deps = {
    saveMedia: jest.fn(async (_req, file) => ({
      file_id: 'f123456',
      filename: file.filename,
      filepath: '/p/f.mp4',
      type: file.type,
      bytes: file.buffer.length,
    })),
    loadImage: jest.fn(),
    loadAudio: jest.fn(),
    fetch: fetchImpl,
  } as unknown as ClipToolDeps;
  const req = { user: { id: 'u1' }, config: undefined } as never;
  const [clip] = createClipTools({ req, toolNames: [ClipTools.clip] }, deps);
  return { clip, deps };
}

const run = async (clip: unknown, payload: unknown = input): Promise<string> => {
  const out = await (clip as { invoke: (i: unknown) => Promise<unknown> }).invoke(payload);
  return typeof out === 'string' ? out : JSON.stringify(out);
};

describe('clip tool diagnostics', () => {
  beforeEach(() => {
    clearClipEvents();
    process.env = {
      ...OLD_ENV,
      REMOTION_SERVICE_URL: 'http://remotion:3200',
      REMOTION_SERVICE_TOKEN: 't'.repeat(40),
    };
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('records invoked, worker.call and saved events without scene text', async () => {
    const fetchImpl = jest.fn(async () => ({
      status: 200,
      json: async () => ({
        ok: true,
        videoBase64: Buffer.from('mp4').toString('base64'),
        jobId: 'j9',
        durationSec: 3,
        warnings: ['tts_failed: edge-tts missing'],
      }),
    })) as unknown as typeof fetch;
    const { clip } = build(fetchImpl);
    await run(clip);
    const names = getClipEvents().map((e) => e.event);
    expect(names).toEqual(['tool.invoked', 'worker.call', 'worker.warning', 'tool.saved']);
    expect(JSON.stringify(getClipEvents())).not.toContain('SECRET-HEADING');
  });

  it('records a worker error with its code, stage and jobId, and tells the model the code', async () => {
    const fetchImpl = jest.fn(async () => ({
      status: 504,
      json: async () => ({
        ok: false,
        error: 'timeout',
        message: 'slow',
        stage: 'render',
        jobId: 'j8',
      }),
    })) as unknown as typeof fetch;
    const { clip, deps } = build(fetchImpl);
    const out = await run(clip);
    expect(out).toContain('code timeout');
    expect(out).toContain('stage render');
    const error = getClipEvents().find((e) => e.event === 'worker.error');
    expect(error?.data).toMatchObject({
      code: 'timeout',
      stage: 'render',
      jobId: 'j8',
      status: 504,
    });
    expect(deps.saveMedia).not.toHaveBeenCalled();
  });

  it('records tool.rejected for invalid input', async () => {
    const { clip } = build(jest.fn() as never);
    await run(clip, { title: 'x', scenes: [] });
    expect(getClipEvents()[0]).toMatchObject({ event: 'tool.rejected' });
  });
});
