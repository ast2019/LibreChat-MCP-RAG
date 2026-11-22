import type { MediaJobRecord, MediaJobUpdate } from '@librechat/data-schemas';
import type { RemotionServiceClient, WorkerJobView } from './client';
import type { ClipJobPayload } from './jobs';
import type { ClipImageService } from './images';
import { RemotionServiceError } from './client';
import { createClipJobRunner } from './jobs';

const payload: ClipJobPayload = {
  request: {
    storyboard: {
      title: 'Energy',
      aspectRatio: '9:16',
      theme: 'midnight',
      brandName: 'HiveGPT',
      captions: true,
      scenes: [
        { type: 'image', durationSec: 3, image: 'img0' },
        { type: 'image', durationSec: 3, image: 'img1' },
      ],
    },
    images: [
      { id: 'img0', source: 'file', fileId: 'file-123456' },
      { id: 'img1', source: 'ai', prompt: 'a wind farm at dusk' },
    ],
    audio: { mode: 'tts' },
    durationSec: 6,
    preview: false,
    version: 1,
    notes: [],
  },
  shortSide: 720,
  maxDurationSec: 90,
  renderTimeoutMs: 600_000,
  filename: 'Energy.mp4',
};

const last = <T>(list: T[]): T => list[list.length - 1];

const job = (extra: Partial<MediaJobRecord> = {}): MediaJobRecord =>
  ({
    id: '65c000000000000000000001',
    user: '64b000000000000000000001',
    kind: 'clip',
    provider: 'remotion',
    providerJobId: 'pending',
    providerModel: 'remotion',
    endpoint: 'remotion',
    context: 'clip_generation',
    status: 'pending',
    fallbackUsd: 0,
    priceMultiplier: 1,
    pollIntervalMs: 3000,
    nextPollAt: new Date(),
    deadline: new Date(Date.now() + 60_000),
    payload: payload as unknown as Record<string, unknown>,
    ...extra,
  }) as MediaJobRecord;

const view = (extra: Partial<WorkerJobView>): WorkerJobView => ({
  jobId: 'w1',
  state: 'running',
  stage: 'render',
  progress: 0.4,
  warnings: [],
  ...extra,
});

function setup(client: Partial<RemotionServiceClient>, aiConfig = true) {
  const updates: MediaJobUpdate[] = [];
  const images: ClipImageService = {
    reserve: jest.fn(),
    generate: jest.fn(async () => ({ buffer: Buffer.from('ai'), type: 'image/png', credits: 40_000 })),
  };
  const deps = {
    claimDueMediaJobs: jest.fn(async () => []),
    updateMediaJob: jest.fn(async (_id: string, update: MediaJobUpdate) => {
      updates.push(update);
      return null;
    }),
    loadOwnerRequest: jest.fn(async () => ({
      user: { id: '64b000000000000000000001' },
      config: { clipTools: { aiImages: aiConfig } },
    }) as never),
    saveMedia: jest.fn(async (_req: unknown, file: { filename: string; type: string; buffer: Buffer }) => ({
      file_id: 'f1',
      filename: file.filename,
      filepath: '/files/f1.mp4',
      type: file.type,
      bytes: file.buffer.length,
    })),
    loadImage: jest.fn(async () => ({ buffer: Buffer.from('png'), type: 'image/png' })),
    loadAudio: jest.fn(async () => null),
    client: () => client as RemotionServiceClient,
    images,
  };
  return { runner: createClipJobRunner(deps), deps, updates, images };
}

describe('clip job runner', () => {
  it('only claims clip jobs', async () => {
    const { runner, deps } = setup({});
    await runner.tick();
    expect(deps.claimDueMediaJobs).toHaveBeenCalledWith(expect.objectContaining({ kinds: ['clip'] }));
  });

  it('resolves images (file and charged AI) and submits the render with the timeout', async () => {
    const submit = jest.fn(async () => view({ jobId: 'w1', state: 'queued', stage: 'queued', progress: 0 }));
    const { runner, updates, images } = setup({ submit });
    await runner.step(job());
    const body = (submit.mock.calls[0] as unknown[])[0] as { assets: Record<string, { mime: string }>; timeoutMs: number; audio: { mode: string } };
    expect(Object.keys(body.assets)).toEqual(['img0', 'img1']);
    expect(body.timeoutMs).toBe(600_000);
    expect(body.audio.mode).toBe('tts');
    expect(images.generate).toHaveBeenCalledWith(expect.anything(), 'a wind farm at dusk', '9:16', undefined);
    expect(last(updates)).toMatchObject({ workerJobId: 'w1', stage: 'queued' });
  });

  it('mirrors stage and progress while the worker renders', async () => {
    const { runner, updates } = setup({ job: jest.fn(async () => view({ stage: 'render', progress: 0.42 })) });
    await runner.step(job({ workerJobId: 'w1', progress: 0.1 }));
    expect(updates[0]).toMatchObject({ stage: 'render', progress: 0.42 });
    expect(updates[0].status).toBeUndefined();
  });

  it('saves the finished MP4 for the owner and completes the job', async () => {
    const video = jest.fn(async () => Buffer.from('mp4'));
    const { runner, updates, deps } = setup({
      job: jest.fn(async () => view({ state: 'done', stage: 'done', progress: 1, warnings: ['unknown_icon: x'] })),
      video,
    });
    await runner.step(job({ workerJobId: 'w1' }));
    expect(deps.saveMedia).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ filename: 'Energy.mp4', context: 'clip_generation', type: 'video/mp4' }));
    expect(last(updates)).toMatchObject({ status: 'completed', filepath: '/files/f1.mp4', progress: 1, warnings: ['unknown_icon: x'] });
  });

  it('a cancel request stops the worker render and fails the job as cancelled', async () => {
    const cancel = jest.fn(async () => view({ state: 'cancelled' }));
    const { runner, updates } = setup({ cancel });
    await runner.step(job({ workerJobId: 'w1', cancelRequested: true }));
    expect(cancel).toHaveBeenCalledWith('w1');
    expect(last(updates)).toEqual({ status: 'failed', errorCode: 'cancelled' });
  });

  it('past the deadline the worker render is cancelled and the job times out', async () => {
    const cancel = jest.fn(async () => view({ state: 'cancelled' }));
    const { runner, updates } = setup({ cancel });
    await runner.step(job({ workerJobId: 'w1', deadline: new Date(Date.now() - 1) }));
    expect(cancel).toHaveBeenCalledWith('w1');
    expect(last(updates)).toEqual({ status: 'failed', errorCode: 'timeout' });
  });

  it('maps worker failures to stable codes and a lost worker job to worker_lost', async () => {
    const failed = setup({ job: jest.fn(async () => view({ state: 'failed', error: 'narration_too_long', message: 'x' })) });
    await failed.runner.step(job({ workerJobId: 'w1' }));
    expect(last(failed.updates)).toEqual({ status: 'failed', errorCode: 'narration_too_long' });
    const lost = setup({
      job: jest.fn(async () => {
        throw new RemotionServiceError('not_found', 'gone', 404);
      }),
    });
    await lost.runner.step(job({ workerJobId: 'w1' }));
    expect(last(lost.updates)).toEqual({ status: 'failed', errorCode: 'worker_lost' });
  });

  it('a busy worker is asked again later; a network blip retries', async () => {
    const busy = setup({
      submit: jest.fn(async () => {
        throw new RemotionServiceError('busy', 'full', 429);
      }),
    });
    await busy.runner.step(job());
    expect(last(busy.updates)).toMatchObject({ stage: 'waiting' });
    expect(busy.updates.some((u) => u.status === 'failed')).toBe(false);
    const blip = setup({
      job: jest.fn(async () => {
        throw new RemotionServiceError('unavailable', 'ECONNRESET');
      }),
    });
    await blip.runner.step(job({ workerJobId: 'w1' }));
    expect(last(blip.updates)?.status).toBeUndefined();
    expect(last(blip.updates)?.nextPollAt).toBeInstanceOf(Date);
  });

  it('a missing image fails the job with image_failed and never submits', async () => {
    const submit = jest.fn();
    const { runner, updates, deps } = setup({ submit });
    deps.loadImage.mockResolvedValueOnce(null as never);
    await runner.step(job());
    expect(submit).not.toHaveBeenCalled();
    expect(last(updates)).toEqual({ status: 'failed', errorCode: 'image_failed' });
  });
});
