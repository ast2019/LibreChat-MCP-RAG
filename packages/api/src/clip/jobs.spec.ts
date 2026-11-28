import type { MediaJobRecord, MediaJobUpdate } from '@librechat/data-schemas';
import type { RemotionServiceClient, WorkerJobView } from './client';
import type { ClipJobPayload } from './jobs';
import type { ClipImageService } from './images';
import { clearClipEvents, getClipEvents } from './diagnostics';
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

const health = { ok: true, active: 0, waiting: 0, maxConcurrent: 1, maxQueue: 10 };

function setup(client: Partial<RemotionServiceClient>, aiConfig = true, clipTools: Record<string, unknown> = {}) {
  const updates: MediaJobUpdate[] = [];
  const images = {
    reserve: jest.fn(),
    generate: jest.fn(async () => ({ ok: true as const, buffer: Buffer.from('ai'), type: 'image/png', credits: 40_000 })),
    release: jest.fn(async () => undefined),
    refund: jest.fn(async () => true),
  } satisfies ClipImageService;
  const deps = {
    claimDueMediaJobs: jest.fn(async () => []),
    updateMediaJob: jest.fn(async (_id: string, update: MediaJobUpdate) => {
      updates.push(update);
      return null;
    }),
    loadOwnerRequest: jest.fn(async () => ({
      user: { id: '64b000000000000000000001' },
      config: { clipTools: { aiImages: aiConfig, ...clipTools } },
    }) as never),
    saveMedia: jest.fn(async (_req: unknown, file: { filename: string; type: string; buffer: Buffer }) => ({
      file_id: file.type.startsWith('image/') ? 'saved-ai-1' : 'f1',
      filename: file.filename,
      filepath: '/files/f1.mp4',
      type: file.type,
      bytes: file.buffer.length,
    })),
    loadImage: jest.fn(async () => ({ buffer: Buffer.from('png'), type: 'image/png' })),
    loadAudio: jest.fn(async () => null),
    client: () => ({ health: jest.fn(async () => health), ...client }) as RemotionServiceClient,
    images,
    fetch: jest.fn(async () => new Response('down', { status: 500 })) as never,
    env: {} as Record<string, string | undefined>,
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
    expect(images.generate).toHaveBeenCalledWith(expect.anything(), 'a wind farm at dusk', '9:16', {
      conversationId: undefined,
      jobId: '65c000000000000000000001',
      beforeRecord: expect.any(Function),
    });
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
    expect(last(updates)).toEqual({ status: 'failed', errorCode: 'cancelled', payload: null });
  });

  it('past the deadline the worker render is cancelled and the job times out', async () => {
    const cancel = jest.fn(async () => view({ state: 'cancelled' }));
    const { runner, updates } = setup({ cancel });
    await runner.step(job({ workerJobId: 'w1', deadline: new Date(Date.now() - 1) }));
    expect(cancel).toHaveBeenCalledWith('w1');
    expect(last(updates)).toEqual({ status: 'failed', errorCode: 'timeout', payload: null });
  });

  it('maps worker failures to stable codes and a lost worker job to worker_lost', async () => {
    const failed = setup({ job: jest.fn(async () => view({ state: 'failed', error: 'narration_too_long', message: 'x' })) });
    await failed.runner.step(job({ workerJobId: 'w1' }));
    expect(last(failed.updates)).toEqual({ status: 'failed', errorCode: 'narration_too_long', payload: null });
    const lost = setup({
      job: jest.fn(async () => {
        throw new RemotionServiceError('not_found', 'gone', 404);
      }),
    });
    await lost.runner.step(job({ workerJobId: 'w1' }));
    expect(last(lost.updates)).toEqual({ status: 'failed', errorCode: 'worker_lost', payload: null });
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
    expect(last(updates)).toEqual({ status: 'failed', errorCode: 'image_failed', payload: null });
  });

  /** The job record as the database holds it after the updates so far. */
  const stored = (base: MediaJobRecord, updates: MediaJobUpdate[]): MediaJobRecord =>
    updates.reduce<MediaJobRecord>((acc, update) => {
      const { payload: next, ...rest } = update;
      return { ...acc, ...rest, ...(next === null ? { payload: undefined } : next ? { payload: next } : {}) };
    }, base);

  it('an AI image is generated and charged once: a retried submit reuses the saved file', async () => {
    const submit = jest
      .fn()
      .mockRejectedValueOnce(new RemotionServiceError('busy', 'full', 429))
      .mockResolvedValueOnce(view({ jobId: 'w1', state: 'queued', stage: 'queued', progress: 0 }));
    const { runner, updates, images, deps } = setup({ submit });
    const first = job();
    await runner.step(first);
    expect(images.generate).toHaveBeenCalledTimes(1);
    expect(deps.saveMedia).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ context: 'image_generation', type: 'image/png' }));
    const after = stored(first, updates);
    const refs = (after.payload as unknown as ClipJobPayload).request.images;
    expect(refs[1]).toEqual({ id: 'img1', source: 'file', fileId: 'saved-ai-1' });
    expect(after.chargedCredits).toBe(40_000);
    /** The retry (a busy answer, or a lease that expired after an api crash) makes nothing new. */
    await runner.step({ ...after, payload: JSON.parse(JSON.stringify(after.payload)) });
    expect(images.generate).toHaveBeenCalledTimes(1);
    expect(deps.loadImage).toHaveBeenCalledWith(expect.anything(), 'saved-ai-1');
    expect(submit).toHaveBeenCalledTimes(2);
    expect(last(updates)).toMatchObject({ workerJobId: 'w1' });
  });

  it('a full worker is not sent the job and nothing is generated', async () => {
    const submit = jest.fn();
    const { runner, updates, images } = setup({
      submit,
      health: jest.fn(async () => ({ ...health, active: 1, waiting: 10 })),
    });
    await runner.step(job());
    expect(images.generate).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(last(updates)).toMatchObject({ stage: 'waiting' });
  });

  it('every 4xx answer except 429 ends the job at once with a stable code', async () => {
    const cases: Array<[number, string]> = [
      [413, 'assets_too_large'],
      [401, 'unavailable'],
      [422, 'invalid_storyboard'],
      [409, 'render_failed'],
    ];
    for (const [status, code] of cases) {
      const submit = jest.fn(async () => {
        throw new RemotionServiceError('x', 'no', status);
      });
      const { runner, updates } = setup({ submit });
      await runner.step(job());
      expect(submit).toHaveBeenCalledTimes(1);
      expect(last(updates)).toMatchObject({ status: 'failed', errorCode: code, payload: null });
    }
  });

  it('a worker 5xx is retried with growing waits, then fails after submitRetries', async () => {
    const submit = jest.fn(async () => {
      throw new RemotionServiceError('failed', 'boom', 500);
    });
    const { runner, updates } = setup({ submit }, true, { submitRetries: 2 });
    let current = job();
    const waits: number[] = [];
    for (let i = 0; i < 3; i++) {
      const before = Date.now();
      await runner.step(current);
      current = stored(current, updates);
      if (current.status === 'pending') {
        waits.push(new Date(current.nextPollAt).getTime() - before);
      }
    }
    expect(submit).toHaveBeenCalledTimes(3);
    expect(waits[1]).toBeGreaterThan(waits[0]);
    expect(current).toMatchObject({ status: 'failed', errorCode: 'unavailable' });
  });

  it('sends the job id as the idempotency key', async () => {
    const submit = jest.fn(async () => view({ jobId: 'w1', state: 'queued' }));
    const { runner } = setup({ submit });
    await runner.step(job());
    expect(submit).toHaveBeenCalledWith(expect.any(Object), { idempotencyKey: '65c000000000000000000001' });
  });

  it('assets over maxAssetMb fail the job before the worker is called', async () => {
    const submit = jest.fn();
    const { runner, updates, deps } = setup({ submit }, true, { maxAssetMb: 1 });
    deps.loadImage.mockResolvedValue({ buffer: Buffer.alloc(2 * 1024 * 1024), type: 'image/png' });
    await runner.step(job());
    expect(submit).not.toHaveBeenCalled();
    expect(last(updates)).toMatchObject({ status: 'failed', errorCode: 'assets_too_large' });
  });

  it('an AI image refused for credit fails as insufficient_credit and releases the hold', async () => {
    const submit = jest.fn();
    const { runner, updates, images } = setup({ submit });
    images.generate.mockResolvedValueOnce({ ok: false, code: 'insufficient_credit' } as never);
    await runner.step(job());
    expect(submit).not.toHaveBeenCalled();
    expect(last(updates)).toMatchObject({ status: 'failed', errorCode: 'insufficient_credit' });
    expect(images.release).toHaveBeenCalledWith('65c000000000000000000001');
  });

  it('diagnostics carry codes, never the stock query or provider text', async () => {
    clearClipEvents();
    const stock: ClipJobPayload = {
      ...payload,
      request: { ...payload.request, images: [{ id: 'img0', source: 'stock', query: 'SECRET-QUERY' }] },
    };
    const { runner, deps } = setup({ submit: jest.fn() });
    deps.env.PEXELS_API_KEY = 'k';
    (deps.fetch as unknown as jest.Mock).mockResolvedValueOnce(new Response('{"photos":[]}', { status: 200 }));
    await runner.step(job({ payload: stock as unknown as Record<string, unknown> }));
    (deps.fetch as unknown as jest.Mock).mockRejectedValueOnce(new Error('upstream echoed SECRET-QUERY'));
    await runner.step(job({ payload: stock as unknown as Record<string, unknown> }));
    const ai = setup({ submit: jest.fn() });
    ai.images.generate.mockRejectedValueOnce(new Error('provider refused SECRET-PROMPT'));
    await ai.runner.step(job());
    const events = JSON.stringify(getClipEvents());
    expect(events).toContain('image_failed');
    expect(events).not.toContain('SECRET');
  });

  it('a finished clip records its AI image charges and drops the storyboard', async () => {
    const video = jest.fn(async () => Buffer.from('mp4'));
    const { runner, updates } = setup({ job: jest.fn(async () => view({ state: 'done', stage: 'done', progress: 1 })), video });
    await runner.step(job({ workerJobId: 'w1', payload: { ...payload, aiCredits: 80_000 } as unknown as Record<string, unknown> }));
    expect(last(updates)).toMatchObject({ status: 'completed', chargedCredits: 80_000, payload: null });
  });

  it('a failed worker cancel is retried once and recorded', async () => {
    clearClipEvents();
    const cancel = jest.fn(async () => {
      throw new RemotionServiceError('unavailable', 'down');
    });
    const { runner, updates } = setup({ cancel });
    await runner.step(job({ workerJobId: 'w1', cancelRequested: true }));
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(getClipEvents().some((e) => e.event === 'worker.cancel_failed')).toBe(true);
    expect(last(updates)).toMatchObject({ status: 'failed', errorCode: 'cancelled' });
  });

  describe('OpenRouter narration', () => {
    const voice = { provider: 'openrouter' as const, voice: 'Kore', model: 'google/gemini-3.8-flash-tts' };
    const spoken: ClipJobPayload = {
      ...payload,
      request: {
        ...payload.request,
        images: [{ id: 'img0', source: 'file', fileId: 'file-123456' }],
        storyboard: {
          ...payload.request.storyboard,
          scenes: [
            { type: 'image', durationSec: 3, image: 'img0', narration: 'سلام' },
            { type: 'image', durationSec: 3, image: 'img0' },
            { type: 'image', durationSec: 3, image: 'img0', narration: 'خداحافظ' },
          ],
        },
        audio: { mode: 'tts', narration: voice },
      },
    };
    const narrationService = () => ({
      reserve: jest.fn(),
      generate: jest.fn(async () => ({ ok: true as const, buffer: Buffer.from('wav'), type: 'audio/wav', credits: 30_000 })),
      release: jest.fn(async () => undefined),
      refund: jest.fn(async () => true),
    });

    it('speaks each narrated scene, sends them as scenes audio and records the charge', async () => {
      const submit = jest.fn(async () => view({ jobId: 'w1', state: 'queued', stage: 'queued', progress: 0 }));
      const { deps, updates } = setup({ submit });
      const narration = narrationService();
      const runner = createClipJobRunner({ ...deps, narration });
      await runner.step(job({ payload: spoken as unknown as Record<string, unknown> }));
      expect(narration.generate).toHaveBeenCalledTimes(2);
      expect(narration.generate).toHaveBeenCalledWith(expect.anything(), 'سلام', voice, expect.objectContaining({ jobId: '65c000000000000000000001' }));
      const body = (submit.mock.calls[0] as unknown[])[0] as {
        assets: Record<string, { kind: string; mime: string }>;
        audio: { mode: string; lines: Record<string, string>; voice?: string };
      };
      expect(body.audio).toEqual({ mode: 'scenes', lines: { 0: 'nar-0', 2: 'nar-2' } });
      expect(body.assets['nar-0']).toMatchObject({ kind: 'audio', mime: 'audio/wav' });
      expect(Object.keys(body.assets)).toEqual(['img0', 'nar-0', 'nar-2']);
      expect(narration.release).toHaveBeenCalledWith('65c000000000000000000001');
      expect(updates.some((u) => u.chargedCredits === 60_000)).toBe(true);
    });

    it('a retry reuses saved lines and never speaks (or charges) a line twice', async () => {
      const submit = jest.fn(async () => view({ jobId: 'w1', state: 'queued', stage: 'queued', progress: 0 }));
      const { deps } = setup({ submit });
      const narration = narrationService();
      const saved = { ...spoken, narrationFiles: { 0: 'saved-nar-0' }, narrationCredits: 30_000 };
      const loadAudio = jest.fn(async () => ({ buffer: Buffer.from('wav'), type: 'audio/wav' }));
      const runner = createClipJobRunner({ ...deps, narration, loadAudio });
      await runner.step(job({ payload: saved as unknown as Record<string, unknown> }));
      expect(loadAudio).toHaveBeenCalledWith(expect.anything(), 'saved-nar-0');
      expect(narration.generate).toHaveBeenCalledTimes(1);
      expect(narration.generate).toHaveBeenCalledWith(expect.anything(), 'خداحافظ', voice, expect.anything());
    });

    it.each([
      ['insufficient_credit', 'insufficient_credit'],
      ['not_allowed', 'narration_failed'],
      ['unconfigured', 'narration_failed'],
    ])('a %s refusal fails the job with %s and submits nothing', async (code, errorCode) => {
      const submit = jest.fn();
      const { deps, updates } = setup({ submit });
      const narration = { ...narrationService(), generate: jest.fn(async () => ({ ok: false as const, code: code as never })) };
      const runner = createClipJobRunner({ ...deps, narration });
      await runner.step(job({ payload: spoken as unknown as Record<string, unknown> }));
      expect(submit).not.toHaveBeenCalled();
      expect(last(updates)).toMatchObject({ status: 'failed', errorCode });
      expect(narration.release).toHaveBeenCalled();
    });

    it('a provider error fails the job with a safe code', async () => {
      const { deps, updates } = setup({ submit: jest.fn() });
      const narration = { ...narrationService(), generate: jest.fn(async () => { throw new Error('secret provider text'); }) };
      const runner = createClipJobRunner({ ...deps, narration });
      await runner.step(job({ payload: spoken as unknown as Record<string, unknown> }));
      expect(last(updates)).toMatchObject({ status: 'failed', errorCode: 'narration_failed' });
      expect(JSON.stringify(getClipEvents())).not.toContain('secret provider text');
    });

    it('a provider failure after two charged lines refunds both once and records 0 credits', async () => {
      const { deps, updates } = setup({ submit: jest.fn() });
      const narration = {
        ...narrationService(),
        generate: jest.fn(async () => {
          throw new Error('down');
        }),
      };
      const charged = { ...spoken, narrationCredits: 60_000 };
      const runner = createClipJobRunner({ ...deps, narration, images: undefined });
      await runner.step(job({ payload: charged as unknown as Record<string, unknown> }));
      expect(narration.refund).toHaveBeenCalledTimes(1);
      expect(narration.refund).toHaveBeenCalledWith(expect.anything(), 60_000, undefined, voice.model);
      expect(last(updates)).toMatchObject({ status: 'failed', errorCode: 'narration_failed' });
      expect(last(updates)).toMatchObject({ chargedCredits: 0 });
    });

    it('saves a refund marker before refunding and keeps the owed amount when the refund fails', async () => {
      const { deps, updates } = setup({ submit: jest.fn() });
      const narration = {
        ...narrationService(),
        generate: jest.fn(async () => {
          throw new Error('down');
        }),
        refund: jest.fn(async () => false),
      };
      const charged = { ...spoken, narrationCredits: 60_000 };
      const runner = createClipJobRunner({ ...deps, narration });
      await runner.step(job({ payload: charged as unknown as Record<string, unknown> }));
      const marker = updates.findIndex((u) => (u.payload as { refundStarted?: boolean } | null)?.refundStarted === true);
      expect(marker).toBeGreaterThanOrEqual(0);
      expect(marker).toBeLessThan(updates.length - 1);
      expect(last(updates)).toMatchObject({
        status: 'failed',
        chargedCredits: 60_000,
        payload: { refundOwed: { narrationCredits: 60_000 } },
      });
    });

    it('does not refund twice when the job is retried after the final write failed', async () => {
      const { deps, updates } = setup({ submit: jest.fn() });
      const narration = {
        ...narrationService(),
        generate: jest.fn(async () => {
          throw new Error('down');
        }),
      };
      const charged = { ...spoken, narrationCredits: 60_000 };
      const stored = job({ payload: charged as unknown as Record<string, unknown> });
      let failNext = false;
      const updateMediaJob = jest.fn(async (id: string, update: Record<string, unknown>) => {
        if (failNext && update.status === 'failed') {
          failNext = false;
          throw new Error('db down');
        }
        updates.push(update as never);
        return null;
      });
      const runner = createClipJobRunner({ ...deps, narration, updateMediaJob: updateMediaJob as never });
      failNext = true;
      await expect(runner.step(stored)).rejects.toThrow('db down');
      expect(narration.refund).toHaveBeenCalledTimes(1);
      await runner.step(stored);
      expect(narration.refund).toHaveBeenCalledTimes(1);
      /** The refund was recorded before the crash, so nothing is owed after the retry. */
      expect(last(updates)).toMatchObject({ status: 'failed', chargedCredits: 0, payload: null });
    });

    it('refunds AI image credits too, through the image service', async () => {
      const { deps, updates, images } = setup({ submit: jest.fn() });
      const narration = narrationService();
      narration.generate = jest.fn(async () => {
        throw new Error('down');
      });
      const charged = { ...spoken, aiCredits: 40_000, narrationCredits: 60_000 };
      const runner = createClipJobRunner({ ...deps, narration });
      await runner.step(job({ payload: charged as unknown as Record<string, unknown> }));
      expect(images.refund).toHaveBeenCalledWith(expect.anything(), 40_000, undefined, undefined);
      expect(narration.refund).toHaveBeenCalledWith(expect.anything(), 60_000, undefined, voice.model);
      expect(last(updates)).toMatchObject({ status: 'failed', chargedCredits: 0 });
      expect(updates.filter((u) => u.status === 'failed')).toHaveLength(1);
    });

    it('insufficient_credit does not refund', async () => {
      const { deps, updates, images } = setup({ submit: jest.fn() });
      const narration = {
        ...narrationService(),
        generate: jest.fn(async () => ({ ok: false as const, code: 'insufficient_credit' as const })),
      };
      const charged = { ...spoken, narrationCredits: 60_000 };
      const runner = createClipJobRunner({ ...deps, narration });
      await runner.step(job({ payload: charged as unknown as Record<string, unknown> }));
      expect(narration.refund).not.toHaveBeenCalled();
      expect(images.refund).not.toHaveBeenCalled();
      expect(last(updates)).toMatchObject({ errorCode: 'insufficient_credit', chargedCredits: 60_000 });
    });

    it('keeps chargedCredits when the refund itself fails', async () => {
      const { deps, updates } = setup({ submit: jest.fn() });
      const narration = {
        ...narrationService(),
        generate: jest.fn(async () => {
          throw new Error('down');
        }),
        refund: jest.fn(async () => false),
      };
      const charged = { ...spoken, narrationCredits: 60_000 };
      const runner = createClipJobRunner({ ...deps, narration });
      await runner.step(job({ payload: charged as unknown as Record<string, unknown> }));
      expect(last(updates)).toMatchObject({ errorCode: 'narration_failed', chargedCredits: 60_000 });
    });

    it('saves each refunded amount at once, so a crash before the final write cannot owe it twice', async () => {
      const { deps, updates } = setup({ submit: jest.fn() });
      const narration = {
        ...narrationService(),
        generate: jest.fn(async () => {
          throw new Error('down');
        }),
        refund: jest.fn(async () => false),
      };
      const charged = { ...spoken, aiCredits: 40_000, narrationCredits: 60_000 };
      const runner = createClipJobRunner({ ...deps, narration });
      await runner.step(job({ payload: charged as unknown as Record<string, unknown> }));
      const saved = updates.find(
        (u) => (u.payload as { refundedCredits?: unknown } | null)?.refundedCredits !== undefined,
      );
      expect(saved?.payload).toMatchObject({ refundedCredits: { aiCredits: 40_000 } });
      expect(
        (saved?.payload as { refundedCredits: Record<string, number> }).refundedCredits.narrationCredits,
      ).toBeUndefined();
    });

    it('owes only what was not refunded when the retry finds a refund marker', async () => {
      const { deps, updates, images } = setup({ submit: jest.fn() });
      const narration = {
        ...narrationService(),
        generate: jest.fn(async () => {
          throw new Error('down');
        }),
      };
      const crashed = {
        ...spoken,
        aiCredits: 40_000,
        narrationCredits: 60_000,
        refundStarted: true,
        refundedCredits: { aiCredits: 40_000 },
      };
      const runner = createClipJobRunner({ ...deps, narration });
      await runner.step(job({ payload: crashed as unknown as Record<string, unknown> }));
      expect(images.refund).not.toHaveBeenCalled();
      expect(narration.refund).not.toHaveBeenCalled();
      expect(last(updates)).toMatchObject({
        status: 'failed',
        chargedCredits: 60_000,
        payload: { refundOwed: { narrationCredits: 60_000 } },
      });
      expect((last(updates).payload as { refundOwed: Record<string, number> }).refundOwed.aiCredits).toBeUndefined();
    });

    it('lists only the kind whose refund failed as owed, not the one that was refunded', async () => {
      const { deps, updates, images } = setup({ submit: jest.fn() });
      const narration = {
        ...narrationService(),
        generate: jest.fn(async () => {
          throw new Error('down');
        }),
        refund: jest.fn(async () => false),
      };
      const charged = { ...spoken, aiCredits: 40_000, narrationCredits: 60_000 };
      const runner = createClipJobRunner({ ...deps, narration });
      await runner.step(job({ payload: charged as unknown as Record<string, unknown> }));
      expect(images.refund).toHaveBeenCalledTimes(1);
      expect(last(updates)).toMatchObject({
        status: 'failed',
        chargedCredits: 60_000,
        payload: { refundOwed: { narrationCredits: 60_000 } },
      });
      expect((last(updates).payload as { refundOwed: Record<string, number> }).refundOwed.aiCredits).toBeUndefined();
    });

    it('writes the charge ahead of the ledger record, so a crash cannot lose it', async () => {
      const submit = jest.fn(async () => view({ jobId: 'w1', state: 'queued', stage: 'queued', progress: 0 }));
      const { deps, updates } = setup({ submit });
      const order: string[] = [];
      const narration = {
        ...narrationService(),
        generate: jest.fn(async (_req: unknown, _text: string, _voice: unknown, options: { beforeRecord?: (c: number) => Promise<void> }) => {
          await options.beforeRecord?.(30_000);
          order.push('record');
          return { ok: true as const, buffer: Buffer.from('wav'), type: 'audio/wav', credits: 30_000 };
        }),
      };
      const updateMediaJob = jest.fn(async (_id: string, update: MediaJobUpdate) => {
        updates.push(update);
        const pending = (update.payload as { pendingCharge?: unknown } | null)?.pendingCharge;
        if (pending) {
          order.push('ahead');
        }
        return null;
      });
      const runner = createClipJobRunner({ ...deps, narration: narration as never, updateMediaJob });
      await runner.step(job({ payload: spoken as unknown as Record<string, unknown> }));
      expect(order.slice(0, 2)).toEqual(['ahead', 'record']);
      expect(updates.some((u) => u.chargedCredits === 60_000)).toBe(true);
      const saves = updates.filter((u) => (u.payload as { narrationFiles?: unknown } | null)?.narrationFiles);
      expect((last(saves).payload as { pendingCharge?: unknown }).pendingCharge).toBeUndefined();
    });

    it('a retry that finds a written-ahead charge records the line again for nothing and counts it once', async () => {
      const submit = jest.fn(async () => view({ jobId: 'w1', state: 'queued', stage: 'queued', progress: 0 }));
      const { deps, updates } = setup({ submit });
      const narration = narrationService();
      const crashed = { ...spoken, pendingCharge: { kind: 'narration', key: 'nar-0', credits: 30_000 } };
      const runner = createClipJobRunner({ ...deps, narration });
      await runner.step(job({ payload: crashed as unknown as Record<string, unknown> }));
      expect(narration.generate).toHaveBeenNthCalledWith(1, expect.anything(), 'سلام', voice, expect.objectContaining({ alreadyCharged: 30_000 }));
      expect((narration.generate.mock.calls[1] as unknown[])[3]).not.toHaveProperty('alreadyCharged');
      const credits = updates.map((u) => u.chargedCredits).filter((c) => c != null);
      expect(Math.max(...(credits as number[]))).toBe(60_000);
    });

    it('refunds a written-ahead charge when the job fails before the line is saved', async () => {
      const { deps, updates } = setup({ submit: jest.fn() });
      const narration = {
        ...narrationService(),
        generate: jest.fn(async () => {
          throw new Error('down');
        }),
      };
      const crashed = { ...spoken, pendingCharge: { kind: 'narration', key: 'nar-0', credits: 30_000 } };
      const runner = createClipJobRunner({ ...deps, narration });
      await runner.step(job({ payload: crashed as unknown as Record<string, unknown> }));
      expect(narration.refund).toHaveBeenCalledWith(expect.anything(), 30_000, undefined, voice.model);
      expect(last(updates)).toMatchObject({ status: 'failed', chargedCredits: 0 });
    });

    it('drops a written-ahead charge the service already undid, so it is not refunded twice', async () => {
      const { deps, updates } = setup({ submit: jest.fn() });
      const narration = {
        ...narrationService(),
        generate: jest.fn(async (_req: unknown, _text: string, _voice: unknown, options: { beforeRecord?: (c: number) => Promise<void> }) => {
          await options.beforeRecord?.(15_000);
          throw new Error('second piece failed, first undone');
        }),
      };
      const runner = createClipJobRunner({ ...deps, narration: narration as never });
      await runner.step(job({ payload: spoken as unknown as Record<string, unknown> }));
      expect(narration.refund).not.toHaveBeenCalled();
      expect(last(updates)).toMatchObject({ status: 'failed', errorCode: 'narration_failed' });
    });

    it('Edge narration still sends audio.mode tts', async () => {
      const submit = jest.fn(async () => view({ jobId: 'w1', state: 'queued', stage: 'queued', progress: 0 }));
      const { runner } = setup({ submit });
      await runner.step(job());
      expect((submit.mock.calls[0] as unknown[])[0]).toMatchObject({ audio: { mode: 'tts' } });
    });
  });
});
