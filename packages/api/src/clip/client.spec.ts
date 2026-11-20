import { createRemotionServiceClient, RemotionServiceError } from './client';
import type { WorkerRenderRequest } from './scene';

const target = { url: 'http://remotion:3200', token: 't'.repeat(40) };
const input = { width: 1, height: 2, durationSec: 5 } as unknown as WorkerRenderRequest;
const reply = (status: number, body: unknown) =>
  jest.fn(async () => ({ status, json: async () => body })) as unknown as typeof fetch;

describe('remotion client', () => {
  it('parses stage, jobId, warnings and timings from a render', async () => {
    const client = createRemotionServiceClient(
      target,
      reply(200, {
        ok: true,
        videoBase64: Buffer.from('mp4').toString('base64'),
        jobId: 'j1',
        timings: { renderMs: 5 },
        warnings: ['tts_failed: x', 7],
        durationSec: 9,
      }),
    );
    const out = await client.render(input);
    expect(out).toMatchObject({ jobId: 'j1', durationSec: 9, warnings: ['tts_failed: x'] });
    expect(out.timings).toEqual({ renderMs: 5 });
  });

  it('keeps stage, detail and jobId on worker errors', async () => {
    const client = createRemotionServiceClient(
      target,
      reply(500, {
        ok: false,
        error: 'render_failed',
        message: 'm',
        stage: 'render',
        detail: 'd',
        jobId: 'j2',
      }),
    );
    await expect(client.render(input)).rejects.toMatchObject({
      code: 'render_failed',
      status: 500,
      stage: 'render',
      detail: 'd',
      jobId: 'j2',
    });
  });

  it('separates a timeout from a connection failure', async () => {
    const timeout = jest.fn(async () => {
      throw Object.assign(new Error('t'), { name: 'TimeoutError' });
    }) as unknown as typeof fetch;
    const refused = jest.fn(async () => {
      throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }) as unknown as typeof fetch;
    const a = (await createRemotionServiceClient(target, timeout)
      .render(input)
      .catch((e) => e)) as RemotionServiceError;
    expect(a).toMatchObject({ code: 'timeout', status: 504 });
    expect(a.message).toContain('timed out after 480s');
    const b = (await createRemotionServiceClient(target, refused)
      .render(input)
      .catch((e) => e)) as RemotionServiceError;
    expect(b).toMatchObject({ code: 'unavailable' });
    expect(b.message).toContain('connection failed: ECONNREFUSED');
  });

  it('calls /status and /logs with the bearer token and query', async () => {
    const fetchImpl = reply(200, { ok: true, entries: [{ id: 1 }], lastId: 1 });
    const client = createRemotionServiceClient(target, fetchImpl);
    expect((await client.logs({ limit: 5, level: 'warn', after: 3 })).entries).toHaveLength(1);
    await client.status();
    const calls = (fetchImpl as unknown as jest.Mock).mock.calls;
    expect(calls[0][0]).toBe('http://remotion:3200/logs?limit=5&level=warn&after=3');
    expect(calls[0][1].headers.Authorization).toBe(`Bearer ${target.token}`);
    expect(calls[1][0]).toBe('http://remotion:3200/status');
  });
});
