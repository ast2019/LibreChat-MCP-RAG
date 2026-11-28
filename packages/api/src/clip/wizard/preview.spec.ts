import type { WorkerJobRequest } from '../scene';
import type { ServerRequest } from '~/types';
import { STYLE_RETRY_MS, STYLE_SAMPLE_SCENE, themeSampleKey } from './styleSample';
import { RemotionServiceError } from '../client';
import { createClipWizard } from './index';
import { CLIP_THEMES } from '../themes';

const ENV = {
  REMOTION_SERVICE_URL: 'http://remotion:3200',
  REMOTION_SERVICE_TOKEN: 't'.repeat(40),
};

const storyboard = {
  title: 'Energy',
  scenes: [
    { type: 'hook', duration_sec: 3, headline: 'H', narration: 'سلام دنیا' },
    { type: 'stat', duration_sec: 3, value: 30, suffix: '%', label: 'renewable', narration: 'x' },
  ],
};

type AppConfig = { config: { clipTools: Record<string, unknown> } };

const appConfig = (clip: Record<string, unknown> = {}): AppConfig => ({
  config: {
    clipTools: { wizard: { enabled: true, access: 'everyone' }, ...clip },
  },
});

const request = (body: unknown, config: AppConfig = appConfig()) =>
  ({ user: { id: 'u1' }, config, body }) as unknown as ServerRequest;

const code = (reply: { body: unknown }) => (reply.body as { error?: { code: string } }).error?.code;

type Stills = (input: WorkerJobRequest) => Promise<{
  stills: Array<{ frame: number; mime: string; base64: string }>;
  warnings: string[];
}>;

function setup(options: { stills?: Stills; env?: Record<string, string>; images?: unknown } = {}) {
  const stored = new Map<string, { key: string; mime: string; base64: string }>();
  const voiceSamples = {
    find: jest.fn(async (key: string) => stored.get(key) ?? null),
    save: jest.fn(async (sample: { key: string; mime: string; base64: string }) => {
      stored.set(sample.key, sample);
    }),
  };
  const stills: jest.MockedFunction<Stills> = jest.fn(
    options.stills ??
      (async (input: WorkerJobRequest) => ({
        stills: input.storyboard.scenes.map((_, index) => ({
          frame: index * 90 + 54,
          mime: 'image/jpeg',
          base64: `frame${index}`,
        })),
        warnings: [],
      })),
  );
  const wizard = createClipWizard({
    voiceSamples,
    stills,
    createMediaJob: jest.fn(),
    countPendingMediaJobs: jest.fn(async () => 0),
    findBalanceByUser: async () => ({ packId: null }),
    loadImage: jest.fn(async () => null),
    loadAudio: jest.fn(async () => null),
    env: options.env ?? ENV,
    ...(options.images ? { images: options.images as never } : {}),
  } as never);
  return { wizard, stills, stored, voiceSamples };
}

describe('wizard preview', () => {
  it('returns the real key frames the worker rendered, one per scene, and charges nothing', async () => {
    const { wizard, stills } = setup();
    const reply = await wizard.preview(request({ storyboard }));
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({
      stills: [
        { frame: 54, mime: 'image/jpeg', base64: 'frame0' },
        { frame: 144, mime: 'image/jpeg', base64: 'frame1' },
      ],
      notes: [],
    });
    const sent = stills.mock.calls[0][0];
    expect(sent.audio).toEqual({ mode: 'none' });
    expect(sent.timeoutMs).toBe(120_000);
    expect(sent.stills).toBe(6);
  });

  it('honors previewStills and previewTimeoutSec from clipTools', async () => {
    const { wizard, stills } = setup();
    await wizard.preview(
      request(
        { storyboard, settings: { aspectRatio: '16:9' } },
        appConfig({ previewStills: 2, previewTimeoutSec: 30 }),
      ),
    );
    const sent = stills.mock.calls[0][0];
    expect(sent.stills).toBe(2);
    expect(sent.timeoutMs).toBe(30_000);
    expect(sent.storyboard.aspectRatio).toBe('16:9');
  });

  it('answers unavailable when previews are off, without calling the worker', async () => {
    const { wizard, stills } = setup();
    const reply = await wizard.preview(request({ storyboard }, appConfig({ preview: false })));
    expect(reply.status).toBe(503);
    expect(code(reply)).toBe('unavailable');
    expect(stills).not.toHaveBeenCalled();
  });

  it('lists field issues for an invalid storyboard', async () => {
    const { wizard, stills } = setup();
    const reply = await wizard.preview(request({ storyboard: { title: 'x', scenes: [] } }));
    expect(reply.status).toBe(422);
    expect(code(reply)).toBe('invalid_storyboard');
    expect(stills).not.toHaveBeenCalled();
  });

  it('answers busy when the worker preview slot is taken, and provider_failed for other failures', async () => {
    const busy = setup({
      stills: async () => {
        throw new RemotionServiceError('busy', 'A preview is already rendering', 429);
      },
    });
    expect(code(await busy.wizard.preview(request({ storyboard })))).toBe('busy');
    const down = setup({
      stills: async () => {
        throw new RemotionServiceError('timeout', 'too slow', 504);
      },
    });
    const reply = await down.wizard.preview(request({ storyboard }));
    expect(reply.status).toBe(502);
    expect(code(reply)).toBe('provider_failed');
  });

  it('passes the worker notes through and refuses a wizard that is off', async () => {
    const { wizard } = setup({
      stills: async () => ({ stills: [], warnings: ['image shown as placeholder'] }),
    });
    const reply = await wizard.preview(request({ storyboard }));
    expect((reply.body as { notes: string[] }).notes).toEqual(['image shown as placeholder']);
    const off = await wizard.preview(request({ storyboard }, { config: { clipTools: {} } }));
    expect(code(off)).toBe('wizard_disabled');
  });

  it('answers unavailable when no render service is configured', async () => {
    const wizard = createClipWizard({
      createMediaJob: jest.fn(),
      countPendingMediaJobs: jest.fn(async () => 0),
      findBalanceByUser: async () => ({ packId: null }),
      loadImage: jest.fn(async () => null),
      loadAudio: jest.fn(async () => null),
      env: {},
    } as never);
    expect(code(await wizard.preview(request({ storyboard })))).toBe('unavailable');
  });
});

describe('wizard style samples', () => {
  const sample = (wizard: ReturnType<typeof setup>['wizard'], kind: string, id: string) =>
    wizard.styleSample(request({ kind, id }));

  it('renders a built-in style once from sample text, stores it and serves it from the store', async () => {
    const { wizard, stills, stored } = setup();
    const first = await sample(wizard, 'theme', 'neon');
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      kind: 'theme',
      id: 'neon',
      mime: 'image/jpeg',
      cached: false,
    });
    const sent = stills.mock.calls[0][0];
    expect(sent.storyboard.theme).toBe('neon');
    expect(sent.storyboard.scenes).toHaveLength(1);
    expect(sent.storyboard.scenes[0]).toMatchObject({
      type: 'hook',
      headline: STYLE_SAMPLE_SCENE.headline,
    });
    expect(sent.stills).toBe(1);
    expect(stored.has(themeSampleKey('neon'))).toBe(true);
    const again = await sample(wizard, 'theme', 'neon');
    expect(again.body).toMatchObject({ cached: true });
    expect(stills).toHaveBeenCalledTimes(1);
  });

  it('serves a sample stored before a restart, and shares one render between simultaneous requests', async () => {
    const stored = setup();
    stored.stored.set(themeSampleKey('aurora'), { key: 'k', mime: 'image/jpeg', base64: 'OLD' });
    const hit = await sample(stored.wizard, 'theme', 'aurora');
    expect(hit.body).toMatchObject({ base64: 'OLD', cached: true });
    expect(stored.stills).not.toHaveBeenCalled();
    const { wizard, stills } = setup();
    await Promise.all([sample(wizard, 'theme', 'sunset'), sample(wizard, 'theme', 'sunset')]);
    expect(stills).toHaveBeenCalledTimes(1);
  });

  it('renders different styles one at a time so the worker slot is never contended', async () => {
    let running = 0;
    let most = 0;
    const { wizard } = setup({
      stills: async () => {
        running += 1;
        most = Math.max(most, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
        return { stills: [{ frame: 1, mime: 'image/jpeg', base64: 'A' }], warnings: [] };
      },
    });
    const replies = await Promise.all(CLIP_THEMES.map((id) => sample(wizard, 'theme', id)));
    expect(replies.every((reply) => reply.status === 200)).toBe(true);
    expect(most).toBe(1);
  });

  it('fails softly, waits before retrying, and recovers', async () => {
    let down = true;
    jest.useFakeTimers({ now: 1_000_000 });
    try {
      const { wizard, stills } = setup({
        stills: async () => {
          if (down) {
            throw new RemotionServiceError('unavailable', 'worker down');
          }
          return { stills: [{ frame: 1, mime: 'image/jpeg', base64: 'OK' }], warnings: [] };
        },
      });
      const failed = await sample(wizard, 'theme', 'daylight');
      expect(failed.status).toBe(502);
      expect(code(failed)).toBe('provider_failed');
      const callsAfterFail = stills.mock.calls.length;
      expect(code(await sample(wizard, 'theme', 'daylight'))).toBe('provider_failed');
      expect(stills.mock.calls.length).toBe(callsAfterFail);
      down = false;
      jest.setSystemTime(1_000_000 + STYLE_RETRY_MS + 1);
      expect((await sample(wizard, 'theme', 'daylight')).status).toBe(200);
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects an unknown style and refuses a wizard that is off', async () => {
    const { wizard } = setup();
    expect(code(await sample(wizard, 'theme', 'nope'))).toBe('invalid_request');
    expect(code(await wizard.styleSample(request({ kind: 'x', id: 'y' })))).toBe('invalid_request');
    const off = await wizard.styleSample(
      request({ kind: 'theme', id: 'neon' }, { config: { clipTools: {} } }),
    );
    expect(code(off)).toBe('wizard_disabled');
  });

  it('shows an AI image model sample only when one is already stored and never renders one', async () => {
    const images = {
      models: () => [{ id: 'img-a', label: 'A', source: 'openrouter', credits: 3 }],
    };
    const { wizard, stills, stored } = setup({ images });
    expect(code(await sample(wizard, 'image', 'img-a'))).toBe('no_sample');
    expect(code(await sample(wizard, 'image', 'unknown'))).toBe('no_sample');
    expect(stills).not.toHaveBeenCalled();
    stored.set('image|img-a', { key: 'image|img-a', mime: 'image/png', base64: 'PNG' });
    const hit = await sample(wizard, 'image', 'img-a');
    expect(hit.body).toMatchObject({ kind: 'image', id: 'img-a', base64: 'PNG', cached: true });
  });

  it('marks only image models with a stored sample in the config and warms the style samples', async () => {
    const images = {
      models: () => [
        { id: 'img-a', label: 'A', source: 'openrouter', credits: 3 },
        { id: 'img-b', label: 'B', source: 'openrouter', credits: 4 },
      ],
    };
    const { wizard, stills, stored } = setup({ images });
    stored.set('image|img-b', { key: 'image|img-b', mime: 'image/png', base64: 'PNG' });
    const reply = await wizard.config(
      request(
        {},
        appConfig({ wizard: { enabled: true, access: 'everyone', images: { enabled: true } } }),
      ),
    );
    expect(reply.status).toBe(200);
    const body = reply.body as {
      preview: boolean;
      imageModels: Array<{ id: string; hasSample?: boolean }>;
    };
    expect(body.preview).toBe(true);
    expect(body.imageModels.map((model) => [model.id, model.hasSample ?? false])).toEqual([
      ['img-a', false],
      ['img-b', true],
    ]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(stills.mock.calls.length).toBe(CLIP_THEMES.length);
    expect(stills.mock.calls.every(([input]) => input.stills === 1)).toBe(true);
  });
});
