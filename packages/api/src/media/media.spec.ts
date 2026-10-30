import { MediaTools } from 'librechat-data-provider';
import type { ServerRequest } from '~/types';
import type { MediaToolDeps } from './tools';
import { checkMediaAccess, getChatMediaTools, getMediaConfig } from './config';
import { generateHiggsfield, generateOpenRouterVideo } from './providers';
import { createMediaTools } from './tools';
import { createMediaJobRunner } from './jobs';

const mediaGeneration = {
  enabled: true,
  paidOnly: true,
  endpoint: 'OpenRouter',
  image: { model: 'google/image', estimateUsd: 0.1 },
  video: { model: 'google/veo', estimateUsdPerSecond: 0.2, pollIntervalMs: 1_000 },
  higgsfield: {
    apiKeyId: '${HF_ID}',
    apiKeySecret: '${HF_SECRET}',
    models: [
      { id: 'higgsfield-ai/soul/v2/standard', kind: 'image', label: 'SOUL', priceUsd: 0.09 },
    ],
  },
};

const appConfig = (overrides: Record<string, unknown> = {}) =>
  ({
    config: { mediaGeneration: { ...mediaGeneration, ...overrides } },
    balance: { enabled: true },
    endpoints: {
      custom: [
        {
          name: 'OpenRouter',
          apiKey: 'sk-test',
          baseURL: 'https://openrouter.ai/api/v1',
          models: { default: ['x'] },
          priceMultiplier: 1.5,
        },
      ],
    },
  }) as never;

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

describe('media config', () => {
  afterEach(() => {
    delete process.env.HF_ID;
    delete process.env.HF_SECRET;
  });

  it('drops Higgsfield until its keys resolve', () => {
    expect(getMediaConfig(appConfig())?.higgsfield).toBeUndefined();
    process.env.HF_ID = 'id';
    process.env.HF_SECRET = 'secret';
    expect(getMediaConfig(appConfig())?.higgsfield).toMatchObject({
      apiKeyId: 'id',
      apiKeySecret: 'secret',
    });
  });

  it('offers the tools in chats but not to switched-off users or confidential specs', () => {
    expect(getChatMediaTools(appConfig(), {})).toEqual([MediaTools.image, MediaTools.video]);
    expect(getChatMediaTools(appConfig(), { mediaAccess: false })).toEqual([]);
    expect(getChatMediaTools(appConfig(), {}, { privacy: 'private' })).toEqual([]);
    expect(getChatMediaTools(appConfig({ enabled: false }), {})).toEqual([]);
  });

  it('lets paid users, admins and switched-on users generate', async () => {
    const config = getMediaConfig(appConfig())!;
    const noPack = jest.fn().mockResolvedValue({ packId: undefined });
    const withPack = jest.fn().mockResolvedValue({ packId: 'starter' });
    expect(await checkMediaAccess(config, { id: 'u' }, noPack)).toEqual({
      ok: false,
      code: 'paid_only',
    });
    expect(await checkMediaAccess(config, { id: 'u' }, withPack)).toEqual({ ok: true });
    expect(await checkMediaAccess(config, { id: 'u', role: 'ADMIN' }, noPack)).toEqual({
      ok: true,
    });
    expect(await checkMediaAccess(config, { id: 'u', mediaAccess: true }, noPack)).toEqual({
      ok: true,
    });
    expect(await checkMediaAccess(config, { id: 'u', mediaAccess: false }, withPack)).toEqual({
      ok: false,
      code: 'media_disabled',
    });
  });
});

describe('media providers', () => {
  const target = {
    name: 'OpenRouter',
    apiKey: 'sk',
    baseURL: 'https://openrouter.ai/api/v1',
    priceMultiplier: 1,
  };

  it('polls a video job until it completes and downloads it', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(json({ id: 'job1', status: 'pending' }))
      .mockResolvedValueOnce(json({ status: 'in_progress' }))
      .mockResolvedValueOnce(json({ status: 'completed', usage: { cost: 0.8 } }))
      .mockResolvedValueOnce(
        new Response(Buffer.from('mp4'), { headers: { 'content-type': 'video/mp4' } }),
      );
    const video = await generateOpenRouterVideo(fetchMock, target, {
      model: 'google/veo',
      prompt: 'a cat',
      duration: 4,
      generateAudio: true,
      pollIntervalMs: 1,
      timeoutMs: 5_000,
    });
    expect(video).toMatchObject({ type: 'video/mp4', costUsd: 0.8 });
    expect(fetchMock.mock.calls[3][0]).toBe(
      'https://openrouter.ai/api/v1/videos/job1/content?index=0',
    );
  });

  it('reports a moderated Higgsfield request as blocked', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(json({ request_id: 'r1', status: 'queued' }))
      .mockResolvedValueOnce(json({ status: 'nsfw' }));
    await expect(
      generateHiggsfield(
        fetchMock,
        { baseURL: 'https://api.higgsfield.ai', apiKeyId: 'a', apiKeySecret: 'b' },
        {
          model: { id: 'x/y', kind: 'image', label: 'X', priceUsd: 0.1 },
          input: { prompt: 'p' },
          idempotencyKey: 'k',
          pollIntervalMs: 1,
          timeoutMs: 5_000,
        },
      ),
    ).rejects.toMatchObject({ code: 'blocked' });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Key a:b');
  });
});

describe('media tools', () => {
  const release = jest.fn().mockResolvedValue(undefined);
  const makeDeps = (over: Partial<MediaToolDeps> = {}) => {
    const billing = {
      hold: jest.fn().mockResolvedValue({ release }),
      record: jest.fn().mockResolvedValue(undefined),
    };
    const deps: MediaToolDeps = {
      billing,
      findBalanceByUser: jest.fn().mockResolvedValue({ packId: 'starter' }),
      saveMedia: jest.fn(),
      loadImage: jest.fn().mockResolvedValue(null),
      createMediaJob: jest.fn(
        async (data) => ({ ...data, id: 'job1', status: 'pending' }) as never,
      ),
      fetch: jest.fn().mockResolvedValue(
        json({
          data: [{ b64_json: Buffer.from('png').toString('base64') }],
          usage: { cost: 0.04 },
        }),
      ),
      ...over,
    };
    return { deps, billing };
  };
  const req = { user: { id: 'u1' }, config: appConfig() } as unknown as ServerRequest;
  const imageTool = (deps: MediaToolDeps) =>
    createMediaTools({ req, toolNames: [MediaTools.image] }, deps)[0];

  beforeEach(() => release.mockClear());

  it('generates an image, shows it, and charges the real cost with the markup', async () => {
    const { deps, billing } = makeDeps();
    const message = await imageTool(deps).invoke({
      id: 'call1',
      name: MediaTools.image,
      args: { prompt: 'a red apple' },
      type: 'tool_call',
    });
    expect(message.artifact.content[0].image_url.url).toMatch(/^data:image\/png;base64,/);
    expect(billing.hold).toHaveBeenCalledWith(req, expect.any(Object), 150_000);
    expect(billing.record).toHaveBeenCalledWith(
      req,
      expect.objectContaining({ context: 'image_generation', model: 'google/image' }),
      60_000,
    );
    expect(release).toHaveBeenCalled();
  });

  it('tells free-trial users how to unlock it without calling the provider', async () => {
    const { deps, billing } = makeDeps({
      findBalanceByUser: jest.fn().mockResolvedValue({ packId: undefined }),
    });
    const message = await imageTool(deps).invoke({
      id: 'call2',
      name: MediaTools.image,
      args: { prompt: 'x' },
      type: 'tool_call',
    });
    expect(JSON.stringify(message.content)).toContain('paid packs');
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(billing.hold).not.toHaveBeenCalled();
  });

  it('charges nothing when the credit does not cover the estimate or the provider fails', async () => {
    const short = makeDeps();
    short.billing.hold.mockResolvedValue('insufficient');
    const refused = await imageTool(short.deps).invoke({
      id: 'call3',
      name: MediaTools.image,
      args: { prompt: 'x' },
      type: 'tool_call',
    });
    expect(JSON.stringify(refused.content)).toContain('does not cover');
    expect(short.deps.fetch).not.toHaveBeenCalled();

    const failing = makeDeps({
      fetch: jest.fn().mockResolvedValue(json({ error: 'boom' }, { status: 502 })),
    });
    const failed = await imageTool(failing.deps).invoke({
      id: 'call4',
      name: MediaTools.image,
      args: { prompt: 'x' },
      type: 'tool_call',
    });
    expect(JSON.stringify(failed.content)).toContain('Nothing was charged');
    expect(failing.billing.record).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
  });
});

describe('background video jobs', () => {
  const release = jest.fn().mockResolvedValue(undefined);
  const req = { user: { id: 'u1' }, config: appConfig() } as unknown as ServerRequest;

  it('starts the video at the provider, answers at once, and charges nothing yet', async () => {
    const billing = { hold: jest.fn().mockResolvedValue({ release }), record: jest.fn() };
    const createMediaJob = jest.fn(async (data) => ({ ...data, id: 'job7' }) as never);
    const deps: MediaToolDeps = {
      billing,
      findBalanceByUser: jest.fn().mockResolvedValue({ packId: 'starter' }),
      saveMedia: jest.fn(),
      loadImage: jest.fn(),
      createMediaJob,
      fetch: jest.fn().mockResolvedValue(json({ id: 'or-job', status: 'pending' })),
    };
    const [videoTool] = createMediaTools({ req, toolNames: [MediaTools.video] }, deps);
    const message = await videoTool.invoke({
      id: 'v1',
      name: MediaTools.video,
      args: { prompt: 'waves', duration_seconds: 4 },
      type: 'tool_call',
    });
    expect(JSON.stringify(message.content)).toContain('/api/media/jobs/job7');
    expect(createMediaJob).toHaveBeenCalledWith(
      expect.objectContaining({
        providerJobId: 'or-job',
        provider: 'openrouter',
        fallbackUsd: 0.8,
      }),
    );
    expect(billing.record).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
  });

  const job = {
    id: 'job7',
    user: 'u1',
    kind: 'video' as const,
    provider: 'openrouter' as const,
    providerJobId: 'or-job',
    providerModel: 'google/veo',
    endpoint: 'OpenRouter',
    context: 'video_generation',
    status: 'pending' as const,
    fallbackUsd: 0.8,
    priceMultiplier: 1.5,
    pollIntervalMs: 10_000,
    nextPollAt: new Date(),
    deadline: new Date(Date.now() + 60_000),
  };

  function runnerWith(fetchMock: jest.Mock, now = () => new Date()) {
    const deps = {
      claimDueMediaJobs: jest.fn().mockResolvedValue([job]),
      updateMediaJob: jest.fn().mockResolvedValue(null),
      loadOwnerRequest: jest.fn().mockResolvedValue(req),
      saveMedia: jest.fn().mockResolvedValue({
        file_id: 'f1',
        filepath: '/images/u1/f1-video.mp4',
        filename: 'f1-video.mp4',
        type: 'video/mp4',
        bytes: 3,
      }),
      billing: { record: jest.fn() },
      fetch: fetchMock,
      now,
    };
    return { runner: createMediaJobRunner(deps), deps };
  }

  it('delivers a finished video and charges the reported cost with the markup', async () => {
    const { runner, deps } = runnerWith(
      jest
        .fn()
        .mockResolvedValueOnce(json({ status: 'completed', usage: { cost: 1 } }))
        .mockResolvedValueOnce(
          new Response(Buffer.from('mp4'), { headers: { 'content-type': 'video/mp4' } }),
        ),
    );
    expect(await runner.tick()).toBe(1);
    expect(deps.billing.record).toHaveBeenCalledWith(
      req,
      expect.objectContaining({ context: 'video_generation' }),
      1_500_000,
    );
    expect(deps.updateMediaJob).toHaveBeenCalledWith(
      'job7',
      expect.objectContaining({ status: 'completed', filepath: '/images/u1/f1-video.mp4' }),
    );
  });

  it('waits on a running job, and never charges a failed or overdue one', async () => {
    const pending = runnerWith(jest.fn().mockResolvedValue(json({ status: 'in_progress' })));
    await pending.runner.tick();
    expect(pending.deps.updateMediaJob).toHaveBeenCalledWith('job7', {
      nextPollAt: expect.any(Date),
    });

    const failed = runnerWith(jest.fn().mockResolvedValue(json({ status: 'failed' })));
    await failed.runner.tick();
    expect(failed.deps.updateMediaJob).toHaveBeenCalledWith('job7', {
      status: 'failed',
      errorCode: 'provider_error',
    });
    expect(failed.deps.billing.record).not.toHaveBeenCalled();

    const late = runnerWith(jest.fn(), () => new Date(Date.now() + 120_000));
    await late.runner.tick();
    expect(late.deps.updateMediaJob).toHaveBeenCalledWith('job7', {
      status: 'failed',
      errorCode: 'timeout',
    });
    expect(late.deps.fetch).not.toHaveBeenCalled();
  });
});
