import type { MediaJobCreateData, MediaJobRecord } from '@librechat/data-schemas';
import type { SpeechProviderClient } from '~/speech/types';
import type { MediaBilling } from '~/media/billing';
import type { ServerRequest } from '~/types';
import { createClipNarrationService } from '../narration';
import { SAMPLE_RETRY_MS, SAMPLE_TEXT } from './sample';
import { RemotionServiceError } from '../client';
import { createClipWizard } from './index';

const ENV = {
  REMOTION_SERVICE_URL: 'http://remotion:3200',
  REMOTION_SERVICE_TOKEN: 't'.repeat(40),
};

const VOICES = [
  {
    id: 'eleven-sarah',
    label: 'سارا',
    lang: 'fa',
    provider: 'openrouter',
    voice: 'sarah',
    model: 'eleven/v3',
    format: 'mp3',
    estimateUsdPerKChar: 0.08,
  },
  {
    id: 'eleven-sarah-en',
    label: 'Sarah',
    lang: 'en',
    provider: 'openrouter',
    voice: 'sarah',
    model: 'eleven/v3',
    format: 'mp3',
    estimateUsdPerKChar: 0.08,
  },
  {
    id: 'fa-IR-DilaraNeural',
    label: 'دیلارا',
    lang: 'fa',
    provider: 'edge',
    voice: 'fa-IR-DilaraNeural',
  },
];

const storyboard = {
  title: 'Energy',
  scenes: [
    { type: 'hook', duration_sec: 3, headline: 'H', narration: 'سلام دنیا' },
    {
      type: 'stat',
      duration_sec: 3,
      value: 30,
      suffix: '%',
      label: 'renewable',
      narration: 'سی درصد',
    },
  ],
};

function appConfig(wizard: Record<string, unknown> = { enabled: true, access: 'everyone' }) {
  return {
    config: {
      clipTools: { wizard, voices: VOICES },
      mediaGeneration: {
        enabled: true,
        paidOnly: true,
        endpoint: 'OpenRouter',
        speech: {
          model: 'default/tts',
          voice: 'Kore',
          format: 'mp3',
          estimateUsd: 0.1,
          maxChars: 500,
        },
      },
    },
    balance: { enabled: true },
    endpoints: {
      custom: [
        {
          name: 'OpenRouter',
          apiKey: 'sk-test',
          baseURL: 'https://openrouter.ai/api/v1',
          models: { default: ['x'] },
          priceMultiplier: 1,
        },
      ],
    },
  };
}

const request = (body: unknown, config = appConfig(), id = 'u1') =>
  ({ user: { id }, config, body }) as unknown as ServerRequest;

function setup({
  balance = 10_000_000,
  packId = 'starter' as string | null,
  synthFails = false,
  edgeFails = false,
  jobFails = false,
  pending = 0,
} = {}) {
  let available = balance;
  const holds = { open: 0 };
  const billing: MediaBilling = {
    hold: jest.fn(async (_req, _charge, credits: number) => {
      if (credits > available) {
        return 'insufficient' as const;
      }
      available -= credits;
      holds.open += 1;
      return {
        release: jest.fn(async () => {
          available += credits;
          holds.open -= 1;
        }),
      };
    }),
    record: jest.fn(async () => undefined),
    refund: jest.fn(async () => true),
  };
  const speechClient: SpeechProviderClient = {
    transcribe: jest.fn(),
    synthesize: jest.fn(async () => {
      if (synthFails) {
        throw new Error('provider down');
      }
      return { audio: Buffer.alloc(480), generationId: undefined };
    }),
    getGenerationCost: jest.fn(),
  };
  const narration = createClipNarrationService({
    billing,
    findBalanceByUser: async () => ({ packId }),
    speechClient,
  });
  const createMediaJob = jest.fn(async (data: MediaJobCreateData) => {
    if (jobFails) {
      throw new RemotionServiceError('unreachable', 'worker down');
    }
    return {
      ...data,
      id: 'job-1',
      status: 'pending',
      nextPollAt: new Date(),
    } as unknown as MediaJobRecord;
  });
  const stored = new Map<string, { key: string; mime: string; base64: string }>();
  const voiceSamples = {
    find: jest.fn(async (key: string) => stored.get(key) ?? null),
    save: jest.fn(async (sample: { key: string; mime: string; base64: string }) => {
      stored.set(sample.key, sample);
    }),
  };
  const speakEdge = jest.fn(async () => {
    if (edgeFails) {
      throw new Error('worker down');
    }
    return { mime: 'audio/mpeg', base64: Buffer.alloc(300).toString('base64') };
  });
  const wizard = createClipWizard({
    voiceSamples,
    speakEdge,
    stills: jest.fn(async () => ({
      stills: [{ frame: 1, mime: 'image/jpeg', base64: 'AAAA' }],
      warnings: [],
    })),
    createMediaJob,
    countPendingMediaJobs: jest.fn(async () => pending),
    findBalanceByUser: async () => ({ packId }),
    loadImage: jest.fn(async () => null),
    loadAudio: jest.fn(async () => null),
    narration,
    env: ENV,
  });
  return {
    wizard,
    billing,
    speechClient,
    createMediaJob,
    holds,
    voiceSamples,
    speakEdge,
    stored,
    spent: () => balance - available,
  };
}

const code = (reply: { body: unknown }) => (reply.body as { error?: { code: string } }).error?.code;

describe('wizard config', () => {
  it('refuses when the wizard is off', async () => {
    const { wizard } = setup();
    const reply = await wizard.config(request({}, appConfig({ enabled: false })));
    expect(reply.status).toBe(403);
    expect(code(reply)).toBe('wizard_disabled');
  });

  it('refuses a user without a pack under access pack, lets a pack user in', async () => {
    const denied = await setup({ packId: null }).wizard.config(
      request({}, appConfig({ enabled: true, access: 'pack' })),
    );
    expect(denied.status).toBe(403);
    expect(code(denied)).toBe('not_allowed');
    const open = await setup().wizard.config(
      request({}, appConfig({ enabled: true, access: 'pack' })),
    );
    expect(open.status).toBe(200);
  });

  it('lets everyone in under access everyone and lists voices with price hints and limits', async () => {
    const reply = await setup({ packId: null }).wizard.config(request({}));
    expect(reply.status).toBe(200);
    const body = reply.body as {
      voices: { id: string; priceHint: string; hasSample: boolean }[];
      limits: { maxScenes: number };
      imageSources: { higgsfield: boolean };
    };
    expect(body.voices.map((v) => [v.id, v.priceHint, v.hasSample])).toEqual([
      ['eleven-sarah', 'paid', true],
      ['eleven-sarah-en', 'paid', true],
      ['fa-IR-DilaraNeural', 'free', true],
    ]);
    expect(body.limits.maxScenes).toBe(20);
    expect(body.imageSources.higgsfield).toBe(false);
  });
});

describe('wizard storyboard validate', () => {
  it('returns field-level issues in a stable shape', async () => {
    const reply = await setup().wizard.validate(
      request({
        storyboard: { title: 'x', scenes: [{ type: 'stat', duration_sec: 3, value: 'many' }] },
      }),
    );
    expect(reply.status).toBe(200);
    const body = reply.body as { ok: boolean; issues: { field: string; message: string }[] };
    expect(body.ok).toBe(false);
    expect(body.issues.length).toBeGreaterThan(0);
    expect(body.issues[0]).toEqual({
      field: expect.stringContaining('scenes[0]'),
      message: expect.any(String),
    });
  });

  it('accepts a storyboard the chat tool accepts', async () => {
    const reply = await setup().wizard.validate(request({ storyboard }));
    expect(reply.body).toMatchObject({ ok: true, durationSec: 6, scenes: 2 });
  });

  it('rejects a body without a storyboard and a disabled wizard', async () => {
    expect(code(await setup().wizard.validate(request({})))).toBe('invalid_request');
    expect(
      code(await setup().wizard.validate(request({ storyboard }, appConfig({ enabled: false })))),
    ).toBe('wizard_disabled');
  });
});

describe('wizard voice sample', () => {
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  it('speaks once at the platform cost, stores the sample and serves everyone from it', async () => {
    const { wizard, speechClient, billing, voiceSamples, spent } = setup();
    const first = await wizard.voiceSample(request({ voiceId: 'eleven-sarah' }));
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      voiceId: 'eleven-sarah',
      cached: false,
      mime: 'audio/mpeg',
    });
    expect(speechClient.synthesize).toHaveBeenCalledTimes(1);
    expect(voiceSamples.save).toHaveBeenCalledTimes(1);
    const second = await wizard.voiceSample(
      request({ voiceId: 'eleven-sarah' }, appConfig(), 'u2'),
    );
    expect(second.body).toMatchObject({ cached: true });
    expect(speechClient.synthesize).toHaveBeenCalledTimes(1);
    expect(billing.hold).not.toHaveBeenCalled();
    expect(billing.record).not.toHaveBeenCalled();
    expect(spent()).toBe(0);
  });

  it('serves a sample stored before a restart without calling the provider', async () => {
    const { wizard, speechClient, stored } = setup();
    stored.set('openrouter|eleven/v3|sarah|fa', {
      key: 'openrouter|eleven/v3|sarah|fa',
      mime: 'audio/mpeg',
      base64: 'AAAA',
    });
    const reply = await wizard.voiceSample(request({ voiceId: 'eleven-sarah' }));
    expect(reply.body).toMatchObject({ cached: true, base64: 'AAAA' });
    expect(speechClient.synthesize).not.toHaveBeenCalled();
  });

  it('keeps one sample per language for the same model and voice', async () => {
    const { wizard, speechClient } = setup();
    const fa = await wizard.voiceSample(request({ voiceId: 'eleven-sarah' }));
    const en = await wizard.voiceSample(request({ voiceId: 'eleven-sarah-en' }));
    expect([fa.body, en.body]).toEqual([
      expect.objectContaining({ cached: false }),
      expect.objectContaining({ cached: false }),
    ]);
    const inputs = (speechClient.synthesize as jest.Mock).mock.calls.map(
      (c) => (c[0] as { input: string }).input,
    );
    expect(inputs).toEqual([SAMPLE_TEXT.fa, SAMPLE_TEXT.en]);
  });

  it('shares one provider call between simultaneous requests for the same voice', async () => {
    const { wizard, speechClient } = setup();
    const replies = await Promise.all(
      [1, 2, 3].map((n) =>
        wizard.voiceSample(request({ voiceId: 'eleven-sarah' }, appConfig(), `u${n}`)),
      ),
    );
    expect(replies.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(speechClient.synthesize).toHaveBeenCalledTimes(1);
  });

  it('makes a free Edge voice sample through the worker and stores it', async () => {
    const { wizard, speakEdge, speechClient, billing, stored } = setup();
    const reply = await wizard.voiceSample(request({ voiceId: 'fa-IR-DilaraNeural' }));
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({
      voiceId: 'fa-IR-DilaraNeural',
      cached: false,
      mime: 'audio/mpeg',
    });
    expect(speakEdge).toHaveBeenCalledWith({
      text: SAMPLE_TEXT.fa,
      lang: 'fa',
      voice: 'fa-IR-DilaraNeural',
    });
    expect(stored.size).toBe(1);
    expect(speechClient.synthesize).not.toHaveBeenCalled();
    expect(billing.hold).not.toHaveBeenCalled();
    expect(
      (await wizard.voiceSample(request({ voiceId: 'fa-IR-DilaraNeural' }))).body,
    ).toMatchObject({
      cached: true,
    });
    expect(speakEdge).toHaveBeenCalledTimes(1);
  });

  it('answers invalid_request for an unknown voice', async () => {
    const { wizard, speechClient } = setup();
    expect(code(await wizard.voiceSample(request({ voiceId: 'nope' })))).toBe('invalid_request');
    expect(speechClient.synthesize).not.toHaveBeenCalled();
  });

  it('serves a paid-voice sample to a user without a pack and charges nobody', async () => {
    const { wizard, speechClient, billing } = setup({ packId: null });
    const reply = await wizard.voiceSample(request({ voiceId: 'eleven-sarah' }));
    expect(reply.status).toBe(200);
    expect(speechClient.synthesize).toHaveBeenCalledTimes(1);
    expect(billing.hold).not.toHaveBeenCalled();
  });

  it('answers provider_failed with no charge, then waits before retrying and recovers once the provider is fixed', async () => {
    const { wizard, speechClient, billing, holds, spent } = setup({ synthFails: true });
    const realNow = Date.now;
    let at = realNow();
    Date.now = () => at;
    try {
      const reply = await wizard.voiceSample(request({ voiceId: 'eleven-sarah' }));
      expect(reply.status).toBe(502);
      expect(code(reply)).toBe('provider_failed');
      expect(billing.record).not.toHaveBeenCalled();
      expect(holds.open).toBe(0);
      expect(spent()).toBe(0);
      /** inside the retry window: no new provider call */
      expect(code(await wizard.voiceSample(request({ voiceId: 'eleven-sarah' })))).toBe(
        'provider_failed',
      );
      expect(speechClient.synthesize).toHaveBeenCalledTimes(1);
      /** the owner fixed the token; after the window the next request makes the sample */
      (speechClient.synthesize as jest.Mock).mockResolvedValue({ audio: Buffer.alloc(480) });
      at += SAMPLE_RETRY_MS + 1;
      expect((await wizard.voiceSample(request({ voiceId: 'eleven-sarah' }))).status).toBe(200);
      expect(speechClient.synthesize).toHaveBeenCalledTimes(2);
    } finally {
      Date.now = realNow;
    }
  });

  it('answers provider_failed for an Edge voice when the worker is down', async () => {
    const { wizard } = setup({ edgeFails: true });
    expect(code(await wizard.voiceSample(request({ voiceId: 'fa-IR-DilaraNeural' })))).toBe(
      'provider_failed',
    );
  });

  it('refuses a user outside the pack rule', async () => {
    const reply = await setup({ packId: null }).wizard.voiceSample(
      request({ voiceId: 'eleven-sarah' }, appConfig({ enabled: true, access: 'pack' })),
    );
    expect(code(reply)).toBe('not_allowed');
  });

  it('makes every missing sample in the background after a config request, tolerating failures', async () => {
    const { wizard, speechClient, speakEdge, stored } = setup({ synthFails: true });
    const reply = await wizard.config(request({}));
    expect(reply.status).toBe(200);
    await flush();
    await flush();
    /** both paid voices failed (bad token) and were skipped; the Edge voice was still made */
    expect(speechClient.synthesize).toHaveBeenCalledTimes(2);
    expect(speakEdge).toHaveBeenCalledTimes(1);
    expect([...stored.keys()].filter((key) => !key.startsWith('theme|'))).toEqual([
      'edge|fa-IR-DilaraNeural|fa',
    ]);
  });
});

describe('wizard render', () => {
  const body = (voiceId?: string) => ({
    storyboard,
    settings: { aspectRatio: '16:9', ...(voiceId ? { voiceId } : {}) },
  });

  it('holds credit for a paid voice, records a clip job and returns its id', async () => {
    const { wizard, createMediaJob, holds } = setup();
    const reply = await wizard.render(request(body('eleven-sarah')));
    expect(reply).toEqual({ status: 200, body: { jobId: 'job-1' } });
    const data = createMediaJob.mock.calls[0][0];
    expect(data).toMatchObject({ kind: 'clip', provider: 'remotion', stage: 'queued' });
    expect(
      (data.payload as { request: { storyboard: { aspectRatio: string } } }).request.storyboard
        .aspectRatio,
    ).toBe('16:9');
    /** the job keeps one hold per narration call until its lines are made */
    expect(holds.open).toBe(2);
  });

  it('renders a free voice or no voice without any hold', async () => {
    const { wizard, holds } = setup();
    expect((await wizard.render(request(body('fa-IR-DilaraNeural')))).status).toBe(200);
    expect((await wizard.render(request(body()))).status).toBe(200);
    expect(holds.open).toBe(0);
  });

  it('answers insufficient_credit and creates no job', async () => {
    const { wizard, createMediaJob, holds } = setup({ balance: 10 });
    const reply = await wizard.render(request(body('eleven-sarah')));
    expect(reply.status).toBe(402);
    expect(code(reply)).toBe('insufficient_credit');
    expect(createMediaJob).not.toHaveBeenCalled();
    expect(holds.open).toBe(0);
  });

  it('answers provider_failed and releases every hold when the worker call fails', async () => {
    const { wizard, holds, spent } = setup({ jobFails: true });
    const reply = await wizard.render(request(body('eleven-sarah')));
    expect(reply.status).toBe(502);
    expect(code(reply)).toBe('provider_failed');
    expect(holds.open).toBe(0);
    expect(spent()).toBe(0);
  });

  it('lists field issues for an invalid storyboard and holds nothing', async () => {
    const { wizard, createMediaJob, holds } = setup();
    const reply = await wizard.render(
      request({
        storyboard: { title: 'x', scenes: [{ type: 'stat', duration_sec: 3, value: 'many' }] },
        settings: {},
      }),
    );
    expect(reply.status).toBe(422);
    expect(code(reply)).toBe('invalid_storyboard');
    expect((reply.body as { issues: unknown[] }).issues.length).toBeGreaterThan(0);
    expect(createMediaJob).not.toHaveBeenCalled();
    expect(holds.open).toBe(0);
  });

  it('answers busy when the user already has the most clips building, and disabled when off', async () => {
    expect(code(await setup({ pending: 99 }).wizard.render(request(body())))).toBe('busy');
    expect(code(await setup().wizard.render(request(body(), appConfig({ enabled: false }))))).toBe(
      'wizard_disabled',
    );
  });

  it('answers not_allowed outside the pack rule', async () => {
    const reply = await setup({ packId: null }).wizard.render(
      request(body(), appConfig({ enabled: true, access: 'pack' })),
    );
    expect(code(reply)).toBe('not_allowed');
  });
});
