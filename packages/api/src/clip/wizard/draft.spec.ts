import { clipToolsSchema } from 'librechat-data-provider';
import type { MediaJobCreateData, MediaJobRecord } from '@librechat/data-schemas';
import type { SpeechProviderClient } from '~/speech/types';
import type { MediaBilling } from '~/media/billing';
import type { ServerRequest } from '~/types';
import { createClipNarrationService } from '../narration';
import { createClipImageService } from '../images';
import { createClipWizard, createWizardLlm } from './index';

const ENV = {
  REMOTION_SERVICE_URL: 'http://remotion:3200',
  REMOTION_SERVICE_TOKEN: 't'.repeat(40),
};

const board = {
  title: 'Energy',
  lang: 'fa',
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

const withImage = {
  ...board,
  scenes: [
    ...board.scenes,
    {
      type: 'image',
      duration_sec: 3,
      image: { source: 'ai', prompt: 'a wind farm' },
      narration: 'باد',
    },
  ],
};

const SPECS = [
  {
    name: 'fast',
    label: 'Fast',
    group: 'Gemini',
    preset: { endpoint: 'OpenRouter', model: 'google/fast' },
  },
  {
    name: 'claude-time',
    label: 'Claude time',
    group: 'ClaudeTime',
    timePack: true,
    preset: { endpoint: 'OpenRouter', model: 'anthropic/c' },
  },
  {
    name: 'claude-time-b',
    label: 'Claude time B',
    group: 'ClaudeTime',
    preset: { endpoint: 'OpenRouter', model: 'anthropic/d' },
  },
  {
    name: 'local-one',
    label: 'Local',
    privacy: 'local',
    preset: { endpoint: 'OpenRouter', model: 'local/x' },
  },
  { name: 'other-endpoint', label: 'Other', preset: { endpoint: 'Anthropic', model: 'claude-x' } },
  {
    name: 'strong',
    label: 'Strong',
    group: 'Claude',
    preset: { endpoint: 'OpenRouter', model: 'anthropic/strong' },
  },
];

const HIGGS = {
  apiKeyId: 'id',
  apiKeySecret: 'secret',
  baseURL: 'https://api.higgsfield.ai',
  pollIntervalMs: 1000,
  timeoutMs: 20_000,
  models: [
    { id: 'hf/soul', kind: 'image', label: 'Soul', priceUsd: 0.1 },
    { id: 'hf/video', kind: 'video', label: 'Video', priceUsd: 1 },
  ],
};

function appConfig({
  images = { enabled: true } as Record<string, unknown>,
  higgsfield = undefined as unknown,
  specs = SPECS as unknown[],
  wizard = {} as Record<string, unknown>,
} = {}) {
  return {
    config: {
      clipTools: {
        wizard: { enabled: true, access: 'everyone', images, ...wizard },
        maxAiImages: 3,
        voices: [
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
            id: 'fa-IR-DilaraNeural',
            label: 'دیلارا',
            lang: 'fa',
            provider: 'edge',
            voice: 'fa-IR-DilaraNeural',
          },
        ],
      },
      mediaGeneration: {
        enabled: true,
        paidOnly: false,
        endpoint: 'OpenRouter',
        image: { model: 'img/default', estimateUsd: 0.04 },
        speech: {
          model: 'default/tts',
          voice: 'Kore',
          format: 'mp3',
          estimateUsd: 0.1,
          maxChars: 500,
        },
        ...(higgsfield ? { higgsfield } : {}),
      },
    },
    modelSpecs: { list: specs },
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

type Answer = { status?: number; body?: unknown; throws?: boolean };

const completion = (content: string, usage = { prompt_tokens: 1000, completion_tokens: 500 }) => ({
  status: 200,
  body: { choices: [{ message: { content } }], usage },
});

function setup({
  balance = 100_000_000,
  answers = [] as Answer[],
  imageFetch = undefined as undefined | jest.Mock,
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
      let released = false;
      return {
        release: jest.fn(async () => {
          if (!released) {
            released = true;
            available += credits;
            holds.open -= 1;
          }
        }),
      };
    }),
    record: jest.fn(async () => undefined),
    refund: jest.fn(async () => true),
  };
  const queue = [...answers];
  const fetchLlm = jest.fn(async () => {
    const next = queue.shift() ?? { status: 500 };
    if (next.throws) {
      throw new Error('socket hang up sk-secret-token');
    }
    return new Response(JSON.stringify(next.body ?? { error: 'provider said: sk-secret-token' }), {
      status: next.status ?? 200,
    });
  });
  const getMultiplier = jest.fn(({ tokenType }: { tokenType?: string }) =>
    tokenType === 'prompt' ? 2 : 6,
  );
  const llm = createWizardLlm({
    billing,
    getMultiplier: getMultiplier as never,
    getEndpointTokenConfig: async () => undefined,
    fetch: fetchLlm as never,
  });
  const speechClient: SpeechProviderClient = {
    transcribe: jest.fn(),
    synthesize: jest.fn(async () => ({ audio: Buffer.alloc(480), generationId: undefined })),
    getGenerationCost: jest.fn(),
  };
  const findBalanceByUser = async () => ({ packId: 'starter' });
  const narration = createClipNarrationService({ billing, findBalanceByUser, speechClient });
  const images = createClipImageService({
    billing,
    findBalanceByUser,
    fetch: (imageFetch ?? jest.fn(async () => new Response('x', { status: 500 }))) as never,
    catalogue: () => undefined,
  });
  const createMediaJob = jest.fn(
    async (data: MediaJobCreateData) =>
      ({
        ...data,
        id: 'job-1',
        status: 'pending',
        nextPollAt: new Date(),
      }) as unknown as MediaJobRecord,
  );
  const wizard = createClipWizard({
    createMediaJob,
    countPendingMediaJobs: jest.fn(async () => 0),
    findBalanceByUser,
    loadImage: jest.fn(async () => null),
    loadAudio: jest.fn(async () => null),
    narration,
    images,
    llm,
    env: ENV,
  });
  return {
    wizard,
    billing,
    fetchLlm,
    createMediaJob,
    holds,
    speechClient,
    images,
    spent: () => balance - available,
  };
}

const code = (reply: { body: unknown }) => (reply.body as { error?: { code: string } }).error?.code;
const draft = (extra: Record<string, unknown> = {}) => ({
  topic: 'renewable energy',
  modelId: 'fast',
  settings: { aspectRatio: '9:16' },
  ...extra,
});
const answerOf = (storyboard: unknown) => completion(JSON.stringify({ storyboard }));

describe('wizard defaults', () => {
  it('keeps aiImages off and the wizard image lever off unless the owner turns them on', () => {
    const parsed = clipToolsSchema.parse({});
    expect(parsed.aiImages).toBe(false);
    expect(parsed.wizard.images).toEqual({ enabled: false, maxCreditsPerClip: 0 });
    expect(parsed.wizard.sampleCharge).toBe('platform');
    expect(parsed.wizard.llm.endpoint).toBe('OpenRouter');
    expect(parsed.wizard.llm.repairAttempts).toBe(1);
  });
});

describe('wizard model list', () => {
  it('lists the app model list on the wizard endpoint without time pack, local or foreign specs', async () => {
    const reply = await setup().wizard.config(request({}));
    const body = reply.body as { models: { id: string; label: string }[]; defaultModelId: string };
    expect(body.models.map((m) => m.id)).toEqual(['fast', 'strong']);
    expect(body.defaultModelId).toBe('fast');
    expect(JSON.stringify(body.models)).not.toContain('anthropic/');
  });

  it('refuses a model that is not on the list and never calls the provider', async () => {
    const { wizard, fetchLlm, billing } = setup();
    for (const modelId of [
      'claude-time',
      'claude-time-b',
      'local-one',
      'other-endpoint',
      'anthropic/strong',
      'nope',
    ]) {
      expect(code(await wizard.draft(request(draft({ modelId }))))).toBe('model_unavailable');
    }
    expect(fetchLlm).not.toHaveBeenCalled();
    expect(billing.hold).not.toHaveBeenCalled();
  });

  it('honors the per-user filtering already applied to the config (an admin-only spec is absent)', async () => {
    const specs = SPECS.filter((spec) => spec.name !== 'strong');
    const reply = await setup().wizard.config(request({}, appConfig({ specs })));
    expect((reply.body as { models: { id: string }[] }).models.map((m) => m.id)).toEqual(['fast']);
    expect(
      code(await setup().wizard.draft(request(draft({ modelId: 'strong' }), appConfig({ specs })))),
    ).toBe('model_unavailable');
  });
});

describe('wizard draft', () => {
  it('drafts a storyboard and charges the real usage once at chat rates', async () => {
    const { wizard, billing, holds, fetchLlm, spent } = setup({ answers: [answerOf(board)] });
    const reply = await wizard.draft(request(draft()));
    expect(reply.status).toBe(200);
    const result = reply.body as {
      storyboard: { title: string; scenes: unknown[] };
      credits: number;
    };
    expect(result.storyboard.title).toBe('Energy');
    /** 1000 prompt tokens x 2 + 500 completion tokens x 6 */
    expect(result.credits).toBe(5000);
    expect(billing.record).toHaveBeenCalledTimes(1);
    expect(billing.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ model: 'google/fast', endpoint: 'OpenRouter' }),
      5000,
    );
    expect(holds.open).toBe(0);
    expect(spent()).toBe(0);
    const sent = JSON.parse(((fetchLlm.mock.calls[0] as unknown[])[1] as { body: string }).body);
    expect(sent.model).toBe('google/fast');
    expect(sent.messages[0].role).toBe('system');
    expect(sent.messages[0].content).not.toContain('renewable energy');
    expect(sent.messages[1]).toEqual({ role: 'user', content: 'Topic:\nrenewable energy' });
  });

  it('forbids image scenes in the prompt for built-in styles and allows AI images otherwise', async () => {
    const builtin = setup({ answers: [answerOf(board)] });
    await builtin.wizard.draft(request(draft({ images: { source: 'builtin' } })));
    const system = JSON.parse(
      ((builtin.fetchLlm.mock.calls[0] as unknown[])[1] as { body: string }).body,
    ).messages[0].content as string;
    expect(system).toContain('Do not use image scenes');
    const ai = setup({ answers: [answerOf(withImage)] });
    const reply = await ai.wizard.draft(request(draft({ images: { source: 'openrouter' } })));
    expect(reply.status).toBe(200);
    const aiSystem = JSON.parse(
      ((ai.fetchLlm.mock.calls[0] as unknown[])[1] as { body: string }).body,
    ).messages[0].content as string;
    expect(aiSystem).toContain('"source":"ai"');
  });

  it('does not send anything or charge when the credit cannot cover the call', async () => {
    const { wizard, fetchLlm, billing, holds } = setup({ balance: 5, answers: [answerOf(board)] });
    const reply = await wizard.draft(request(draft()));
    expect(reply.status).toBe(402);
    expect(code(reply)).toBe('insufficient_credit');
    expect(fetchLlm).not.toHaveBeenCalled();
    expect(billing.record).not.toHaveBeenCalled();
    expect(holds.open).toBe(0);
  });

  it.each([
    ['an HTTP 500', { status: 500 }],
    ['a network or timeout error', { throws: true }],
    ['an answer that is not JSON', completion('sorry, here is a poem')],
    ['an empty answer', completion('')],
    ['an answer without content', { status: 200, body: { choices: [] } }],
  ])(
    'answers provider_failed, charges nothing and releases the hold on %s',
    async (_name, answer) => {
      const { wizard, billing, holds, spent } = setup({
        answers: [answer as Answer, answer as Answer],
      });
      const reply = await wizard.draft(request(draft()));
      expect(reply.status).toBe(502);
      expect(code(reply)).toBe('provider_failed');
      expect(billing.record).not.toHaveBeenCalled();
      expect(holds.open).toBe(0);
      expect(spent()).toBe(0);
      expect(JSON.stringify(reply.body)).not.toContain('sk-secret-token');
      expect(JSON.stringify(reply.body)).not.toContain('poem');
    },
  );

  it('feeds validator issues back once, then charges the summed usage once', async () => {
    const broken = { title: 'x', scenes: [{ type: 'stat', duration_sec: 3, value: 'many' }] };
    const { wizard, billing, fetchLlm } = setup({ answers: [answerOf(broken), answerOf(board)] });
    const reply = await wizard.draft(request(draft()));
    expect(reply.status).toBe(200);
    expect(fetchLlm).toHaveBeenCalledTimes(2);
    const second = JSON.parse(
      ((fetchLlm.mock.calls[1] as unknown[])[1] as { body: string }).body,
    ).messages;
    expect(second[second.length - 1].content).toContain('scenes[0]');
    expect(billing.record).toHaveBeenCalledTimes(1);
    expect((reply.body as { credits: number }).credits).toBe(10_000);
  });

  it('answers provider_failed and charges nothing when the storyboard stays invalid', async () => {
    const broken = { title: 'x', scenes: [{ type: 'stat', duration_sec: 3, value: 'many' }] };
    const { wizard, billing, fetchLlm, holds } = setup({
      answers: [answerOf(broken), answerOf(broken)],
    });
    const reply = await wizard.draft(request(draft()));
    expect(code(reply)).toBe('provider_failed');
    expect(fetchLlm).toHaveBeenCalledTimes(2);
    expect(billing.record).not.toHaveBeenCalled();
    expect(holds.open).toBe(0);
  });

  it('never takes the voice, preview or logo from the model and uses the chosen aspect ratio', async () => {
    const { wizard } = setup({
      answers: [
        answerOf({
          ...board,
          audio: { mode: 'tts' },
          preview: true,
          logo_file_id: 'x',
          aspect_ratio: '1:1',
        }),
      ],
    });
    const reply = await wizard.draft(request(draft({ settings: { aspectRatio: '16:9' } })));
    const result = reply.body as { storyboard: Record<string, unknown> };
    expect(result.storyboard.audio).toBeUndefined();
    expect(result.storyboard.preview).toBeUndefined();
    expect(result.storyboard.logo_file_id).toBeUndefined();
    expect(result.storyboard.aspect_ratio).toBe('16:9');
  });

  it('rejects a bad body and a topic over the limit before any call', async () => {
    const { wizard, fetchLlm } = setup();
    expect(code(await wizard.draft(request({ modelId: 'fast' })))).toBe('invalid_request');
    expect(code(await wizard.draft(request(draft({ topic: 'x'.repeat(5000) }))))).toBe(
      'invalid_request',
    );
    expect(fetchLlm).not.toHaveBeenCalled();
  });

  it('follows the wizard access rule', async () => {
    const config = appConfig({ wizard: { access: 'pack' } });
    config.config.mediaGeneration.paidOnly = true;
    const base = setup({ answers: [answerOf(board)] });
    const reply = await createClipWizard({
      createMediaJob: jest.fn(),
      countPendingMediaJobs: jest.fn(),
      findBalanceByUser: async () => ({ packId: null }),
      loadImage: jest.fn(),
      loadAudio: jest.fn(),
      llm: createWizardLlm({
        billing: base.billing,
        getMultiplier: () => 1,
        getEndpointTokenConfig: async () => undefined,
        fetch: base.fetchLlm as never,
      }),
    }).draft(request(draft(), config));
    expect(code(reply)).toBe('not_allowed');
    expect(base.fetchLlm).not.toHaveBeenCalled();
  });
});

describe('wizard chat', () => {
  const chat = (extra: Record<string, unknown> = {}) => ({
    modelId: 'fast',
    messages: [{ role: 'user', content: 'make it shorter' }],
    storyboard: board,
    topic: 'energy',
    settings: {},
    ...extra,
  });

  it('returns an edited storyboard and charges the call', async () => {
    const edited = { ...board, title: 'Short' };
    const { wizard, billing } = setup({
      answers: [completion(JSON.stringify({ reply: 'Done', storyboard: edited }))],
    });
    const reply = await wizard.chat(request(chat()));
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({
      reply: 'Done',
      storyboard: { title: 'Short' },
      credits: 5000,
    });
    expect(billing.record).toHaveBeenCalledTimes(1);
  });

  it('returns only the reply for a question and still charges its tokens', async () => {
    const { wizard, billing } = setup({
      answers: [completion(JSON.stringify({ reply: 'Nine scenes' }))],
    });
    const reply = await wizard.chat(request(chat()));
    expect(reply.body).toEqual({ reply: 'Nine scenes', storyboard: null, credits: 5000 });
    expect(billing.record).toHaveBeenCalledTimes(1);
  });

  it('keeps the storyboard and topic in a user turn, not the system prompt, and bounds the history', async () => {
    const { wizard, fetchLlm } = setup({ answers: [completion(JSON.stringify({ reply: 'ok' }))] });
    const messages = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `m${i}`,
    }));
    messages.push({ role: 'user', content: 'last' });
    await wizard.chat(request(chat({ messages, topic: 'secret topic' })));
    const sent = JSON.parse(((fetchLlm.mock.calls[0] as unknown[])[1] as { body: string }).body)
      .messages as { role: string; content: string }[];
    expect(sent[0].content).not.toContain('secret topic');
    expect(sent[1].content).toContain('secret topic');
    expect(sent[sent.length - 1]).toEqual({ role: 'user', content: 'last' });
    expect(sent.length).toBeLessThanOrEqual(2 + 1 + 10);
  });

  it('repairs an invalid edit once; an unrepairable one is provider_failed with no charge', async () => {
    const broken = { title: 'x', scenes: [{ type: 'stat', duration_sec: 3, value: 'many' }] };
    const bad = completion(JSON.stringify({ reply: 'ok', storyboard: broken }));
    const failing = setup({ answers: [bad, bad] });
    expect(code(await failing.wizard.chat(request(chat())))).toBe('provider_failed');
    expect(failing.billing.record).not.toHaveBeenCalled();
    expect(failing.holds.open).toBe(0);
    const fixed = setup({
      answers: [bad, completion(JSON.stringify({ reply: 'fixed', storyboard: board }))],
    });
    const reply = await fixed.wizard.chat(request(chat()));
    expect(reply.body).toMatchObject({ reply: 'fixed' });
    expect(fixed.billing.record).toHaveBeenCalledTimes(1);
  });

  it('rejects an over-long message or a history that does not end with the user', async () => {
    const { wizard, fetchLlm } = setup();
    expect(
      code(
        await wizard.chat(
          request(chat({ messages: [{ role: 'user', content: 'x'.repeat(2500) }] })),
        ),
      ),
    ).toBe('invalid_request');
    expect(
      code(await wizard.chat(request(chat({ messages: [{ role: 'assistant', content: 'hi' }] })))),
    ).toBe('invalid_request');
    expect(fetchLlm).not.toHaveBeenCalled();
  });

  it('answers insufficient_credit without calling the model', async () => {
    const { wizard, fetchLlm } = setup({ balance: 1 });
    expect(code(await wizard.chat(request(chat())))).toBe('insufficient_credit');
    expect(fetchLlm).not.toHaveBeenCalled();
  });
});

describe('wizard estimate', () => {
  const body = (extra: Record<string, unknown> = {}) => ({
    storyboard: withImage,
    settings: { images: { source: 'openrouter' }, ...extra },
  });

  it('adds narration and image credits and reports the cap, charging and holding nothing', async () => {
    const config = appConfig({ images: { enabled: true, maxCreditsPerClip: 500_000 } });
    const { wizard, billing } = setup();
    const reply = await wizard.estimate(request(body({ voiceId: 'eleven-sarah' }), config));
    expect(reply.status).toBe(200);
    const result = reply.body as {
      ok: true;
      items: { narrationCredits: number; imageCredits: number };
      imageCount: number;
      totalCredits: number;
      capCredits?: number;
    };
    expect(result.imageCount).toBe(1);
    /** $0.04 image at multiplier 1 */
    expect(result.items.imageCredits).toBe(40_000);
    /** lines of 9, 7 and 3 characters at $0.08 per 1000 characters: 720 + 560 + 240 credits */
    expect(result.items.narrationCredits).toBe(1520);
    expect(result.totalCredits).toBe(result.items.narrationCredits + result.items.imageCredits);
    expect(result.capCredits).toBe(500_000);
    expect(billing.hold).not.toHaveBeenCalled();
    expect(billing.record).not.toHaveBeenCalled();
  });

  it('prices a free voice and built-in images at zero', async () => {
    const reply = await setup().wizard.estimate(
      request({
        storyboard: board,
        settings: { voiceId: 'fa-IR-DilaraNeural', images: { source: 'builtin' } },
      }),
    );
    expect(reply.body).toMatchObject({
      ok: true,
      items: { narrationCredits: 0, imageCredits: 0 },
      imageCount: 0,
      totalCredits: 0,
    });
  });

  it('lists issues for an invalid storyboard and refuses AI images the user did not choose', async () => {
    const wizard = setup().wizard;
    const bad = await wizard.estimate(
      request({
        storyboard: { title: 'x', scenes: [{ type: 'stat', duration_sec: 3, value: 'many' }] },
        settings: {},
      }),
    );
    expect(bad.body).toMatchObject({ ok: false });
    const off = await wizard.estimate(
      request({ storyboard: withImage, settings: { images: { source: 'builtin' } } }),
    );
    expect(off.body).toMatchObject({ ok: false });
  });

  it('refuses an unknown image model and Higgsfield while not connected', async () => {
    const wizard = setup().wizard;
    expect(
      code(
        await wizard.estimate(
          request(body({ images: { source: 'openrouter', modelId: 'nope/model' } })),
        ),
      ),
    ).toBe('model_unavailable');
    expect(code(await wizard.estimate(request(body({ images: { source: 'higgsfield' } }))))).toBe(
      'unavailable',
    );
  });
});

describe('wizard images', () => {
  const render = (extra: Record<string, unknown> = {}) => ({
    storyboard: withImage,
    settings: { images: { source: 'openrouter' }, ...extra },
  });

  it('turns AI images on only through the wizard lever and the user pick', async () => {
    const off = setup();
    const noLever = appConfig({ images: { enabled: false } });
    expect(code(await off.wizard.render(request(render(), noLever)))).toBe('unavailable');
    const builtin = await off.wizard.render(
      request({ storyboard: withImage, settings: { images: { source: 'builtin' } } }),
    );
    expect(code(builtin)).toBe('invalid_storyboard');
    const ok = setup();
    const reply = await ok.wizard.render(request(render()));
    expect(reply).toEqual({ status: 200, body: { jobId: 'job-1' } });
    const payload = ok.createMediaJob.mock.calls[0][0].payload as { imagePick?: unknown };
    expect(payload.imagePick).toEqual({ source: 'openrouter' });
    expect(ok.holds.open).toBe(1);
  });

  it('refuses before anything is held when the estimate is over the cap', async () => {
    const { wizard, createMediaJob, holds, billing } = setup();
    const reply = await wizard.render(
      request(render({ images: { source: 'openrouter', maxCredits: 10_000 } })),
    );
    expect(reply.status).toBe(422);
    expect(code(reply)).toBe('cap_exceeded');
    expect(createMediaJob).not.toHaveBeenCalled();
    expect(billing.hold).not.toHaveBeenCalled();
    expect(holds.open).toBe(0);
    const deployment = setup();
    const capped = appConfig({ images: { enabled: true, maxCreditsPerClip: 10_000 } });
    expect(code(await deployment.wizard.render(request(render(), capped)))).toBe('cap_exceeded');
  });

  it('refuses an unknown image model instead of using the default', async () => {
    const { wizard, createMediaJob } = setup();
    const reply = await wizard.render(
      request(render({ images: { source: 'openrouter', modelId: 'nope/model' } })),
    );
    expect(code(reply)).toBe('model_unavailable');
    expect(createMediaJob).not.toHaveBeenCalled();
  });

  it('answers insufficient_credit for the image hold and creates no job', async () => {
    const { wizard, createMediaJob, holds } = setup({ balance: 100 });
    expect(code(await wizard.render(request(render())))).toBe('insufficient_credit');
    expect(createMediaJob).not.toHaveBeenCalled();
    expect(holds.open).toBe(0);
  });

  describe('Higgsfield', () => {
    it('is absent from the config and refused everywhere while the keys do not resolve', async () => {
      const unresolved = appConfig({ higgsfield: { ...HIGGS, apiKeyId: '${HF_ID_MISSING_XYZ}' } });
      const { wizard, createMediaJob } = setup();
      const config = await wizard.config(request({}, unresolved));
      const body = config.body as {
        imageSources: { higgsfield: boolean };
        imageModels: { source: string }[];
      };
      expect(body.imageSources.higgsfield).toBe(false);
      expect(body.imageModels.some((m) => m.source === 'higgsfield')).toBe(false);
      expect(JSON.stringify(config.body)).not.toContain('hf/');
      const pick = { images: { source: 'higgsfield', modelId: 'hf/soul' } };
      expect(code(await wizard.render(request(render(pick), unresolved)))).toBe('unavailable');
      expect(code(await wizard.draft(request(draft(pick), unresolved)))).toBe('unavailable');
      expect(createMediaJob).not.toHaveBeenCalled();
    });

    it('is listed with image models and prices once connected, and refuses video models', async () => {
      const connected = appConfig({ higgsfield: HIGGS });
      const { wizard } = setup();
      const config = await wizard.config(request({}, connected));
      const body = config.body as {
        imageSources: { higgsfield: boolean; ai: boolean };
        imageModels: { id: string; source: string; credits: number }[];
      };
      expect(body.imageSources).toMatchObject({ higgsfield: true, ai: true });
      expect(body.imageModels).toContainEqual({
        id: 'hf/soul',
        label: 'Soul',
        source: 'higgsfield',
        credits: 100_000,
      });
      expect(body.imageModels.find((m) => m.id === 'hf/video')).toBeUndefined();
      const video = await wizard.render(
        request(render({ images: { source: 'higgsfield', modelId: 'hf/video' } }), connected),
      );
      expect(code(video)).toBe('model_unavailable');
    });

    it('holds the model price when connected and hides it when the lever is off', async () => {
      const connected = appConfig({ higgsfield: HIGGS });
      const { wizard, createMediaJob, holds } = setup();
      const reply = await wizard.render(
        request(render({ images: { source: 'higgsfield', modelId: 'hf/soul' } }), connected),
      );
      expect(reply.status).toBe(200);
      expect((createMediaJob.mock.calls[0][0].payload as { imagePick: unknown }).imagePick).toEqual(
        { source: 'higgsfield', modelId: 'hf/soul' },
      );
      expect(holds.open).toBe(1);
      const leverOff = appConfig({ higgsfield: HIGGS, images: { enabled: false } });
      const hidden = (await wizard.config(request({}, leverOff))).body as {
        imageSources: { higgsfield: boolean };
      };
      expect(hidden.imageSources.higgsfield).toBe(false);
    });

    it('charges nothing and releases its hold when Higgsfield fails', async () => {
      const connected = appConfig({ higgsfield: HIGGS });
      const imageFetch = jest.fn(async () => new Response('boom sk-secret-token', { status: 500 }));
      const { images, billing, holds } = setup({ imageFetch });
      const req = request({}, connected);
      await expect(
        images.generate(req, 'a wind farm', '9:16', {
          pick: { source: 'higgsfield', modelId: 'hf/soul' },
        }),
      ).rejects.toBeDefined();
      expect(billing.record).not.toHaveBeenCalled();
      expect(holds.open).toBe(0);
      expect(imageFetch).toHaveBeenCalled();
    });

    it('refunds Higgsfield charges under the Higgsfield ledger model', async () => {
      const connected = appConfig({ higgsfield: HIGGS });
      const { images, billing } = setup();
      await images.refund?.(request({}, connected), 100_000, undefined, {
        source: 'higgsfield',
        modelId: 'hf/soul',
      });
      expect(billing.refund).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ model: 'hf/soul', endpoint: 'Higgsfield' }),
        100_000,
      );
    });
  });
});

describe('wizard voice sample charge', () => {
  it('charges nobody whatever sampleCharge says: the platform pays', async () => {
    for (const sampleCharge of ['platform', 'requester']) {
      const { wizard, billing, speechClient } = setup();
      const config = appConfig({ wizard: { sampleCharge } });
      const reply = await wizard.voiceSample(request({ voiceId: 'eleven-sarah' }, config));
      expect(reply.status).toBe(200);
      expect(speechClient.synthesize).toHaveBeenCalledTimes(1);
      expect(billing.hold).not.toHaveBeenCalled();
      expect(billing.record).not.toHaveBeenCalled();
    }
  });
});
