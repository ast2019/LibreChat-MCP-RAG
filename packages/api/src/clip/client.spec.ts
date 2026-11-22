import { createRemotionServiceClient, RemotionServiceError } from './client';
import type { WorkerJobRequest } from './scene';

const target = { url: 'http://remotion:3200', token: 't'.repeat(40) };
const body: WorkerJobRequest = {
  storyboard: {
    title: 'x',
    aspectRatio: '9:16',
    theme: 'midnight',
    brandName: 'HiveGPT',
    captions: true,
    scenes: [{ type: 'hook', durationSec: 2, headline: 'a' }],
  },
  assets: {},
  audio: { mode: 'none' },
  shortSide: 720,
  maxDurationSec: 90,
  timeoutMs: 600_000,
};

const respond = (status: number, json: unknown) =>
  jest.fn(async () => ({ status, json: async () => json })) as unknown as typeof fetch;

describe('createRemotionServiceClient', () => {
  it('submits a job with the bearer token and a short budget', async () => {
    const fetchImpl = respond(202, { ok: true, jobId: 'abc123def456', state: 'queued', stage: 'queued', progress: 0, warnings: [] });
    const client = createRemotionServiceClient(target, fetchImpl);
    const view = await client.submit(body);
    expect(view).toMatchObject({ jobId: 'abc123def456', state: 'queued' });
    const [url, init] = (fetchImpl as unknown as jest.Mock).mock.calls[0];
    expect(url).toBe('http://remotion:3200/jobs');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${target.token}`);
    expect(init.signal).toBeDefined();
  });

  it('turns a validation answer into a coded error with the field list', async () => {
    const client = createRemotionServiceClient(
      target,
      respond(400, { ok: false, error: 'invalid_storyboard', message: 'bad', errors: ['scenes[0].headline: is required'] }),
    );
    await expect(client.submit(body)).rejects.toMatchObject({
      code: 'invalid_storyboard',
      status: 400,
      errors: ['scenes[0].headline: is required'],
    });
  });

  it('maps 429 to busy and 404 to a not-found error', async () => {
    await expect(createRemotionServiceClient(target, respond(429, { message: 'full' })).submit(body)).rejects.toMatchObject({ code: 'busy' });
    await expect(createRemotionServiceClient(target, respond(404, { error: 'not_found' })).job('abc123def456')).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
    });
  });

  it('reports connection failures and timeouts as coded errors', async () => {
    const refused = jest.fn(async () => {
      throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }) as unknown as typeof fetch;
    await expect(createRemotionServiceClient(target, refused).job('abc123def456')).rejects.toMatchObject({
      code: 'unavailable',
      message: expect.stringContaining('ECONNREFUSED'),
    });
    const slow = jest.fn(async () => {
      throw Object.assign(new Error('t'), { name: 'TimeoutError' });
    }) as unknown as typeof fetch;
    const error = await createRemotionServiceClient(target, slow).cancel('abc123def456').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RemotionServiceError);
    expect((error as RemotionServiceError).code).toBe('timeout');
  });

  it('downloads the finished video', async () => {
    const fetchImpl = jest.fn(async () => ({ status: 200, arrayBuffer: async () => new TextEncoder().encode('mp4').buffer })) as unknown as typeof fetch;
    const video = await createRemotionServiceClient(target, fetchImpl).video('abc123def456');
    expect(video.toString()).toBe('mp4');
    expect((fetchImpl as unknown as jest.Mock).mock.calls[0][0]).toBe('http://remotion:3200/jobs/abc123def456/video');
  });
});
