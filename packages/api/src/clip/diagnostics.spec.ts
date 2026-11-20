import { CLIP_EVENT_LIMIT, clearClipEvents, getClipEvents, recordClipEvent } from './diagnostics';
import { getRemotionDiagnostics } from './probe';

const ENV = {
  REMOTION_SERVICE_URL: 'http://remotion-worker.internal:3200',
  REMOTION_SERVICE_TOKEN: 't'.repeat(40),
};

const json = (status: number, body: unknown) =>
  Promise.resolve({ status, json: async () => body }) as unknown as Promise<Response>;

function fakeFetch(routes: Record<string, () => Promise<Response>>) {
  return jest.fn(async (url: string) => {
    const path = new URL(url).pathname;
    const route = routes[path];
    if (!route) {
      throw new Error(`no route ${path}`);
    }
    return route();
  }) as unknown as typeof fetch;
}

describe('clip event ring', () => {
  beforeEach(clearClipEvents);

  it('keeps only the newest 200 events', () => {
    for (let i = 0; i < CLIP_EVENT_LIMIT + 25; i++) {
      recordClipEvent({ event: 'worker.call', ms: i });
    }
    const events = getClipEvents();
    expect(events).toHaveLength(CLIP_EVENT_LIMIT);
    expect(events[0].data.ms).toBe(25);
  });

  it('drops keys that could carry text, media or secrets', () => {
    recordClipEvent({
      event: 'tool.invoked',
      theme: 'chalkboard',
      ttsText: 'secret words',
      audioBase64: 'AAAA',
      heading: 'h',
      token: 'x',
    } as never);
    expect(getClipEvents()[0].data).toEqual({ theme: 'chalkboard' });
  });
});

describe('getRemotionDiagnostics', () => {
  beforeEach(clearClipEvents);

  it('names the missing env vars when not configured', async () => {
    const d = await getRemotionDiagnostics({ env: {}, fetch: jest.fn() as never });
    expect(d.configured).toBe(false);
    expect(d.hints.join(' ')).toContain('REMOTION_SERVICE_URL');
    expect(d.hints.join(' ')).toContain('REMOTION_SERVICE_TOKEN');
  });

  it('flags a short token', async () => {
    const d = await getRemotionDiagnostics({
      env: { REMOTION_SERVICE_URL: 'http://x:1', REMOTION_SERVICE_TOKEN: 'short' },
      fetch: jest.fn() as never,
    });
    expect(d.configured).toBe(false);
    expect(d.hints.join(' ')).toContain('shorter than 32');
  });

  it('reports an unreachable worker without throwing', async () => {
    const fetchImpl = jest.fn(async () => {
      throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }) as unknown as typeof fetch;
    const d = await getRemotionDiagnostics({ env: ENV, fetch: fetchImpl });
    expect(d.configured).toBe(true);
    expect(d.urlHost).toBe('remotion-worker.internal');
    expect(d.health?.ok).toBe(false);
    expect(d.health?.error).toContain('ECONNREFUSED');
    expect(d.hints.join(' ')).toContain('OOM-killed');
  });

  it('explains a token mismatch (401)', async () => {
    const d = await getRemotionDiagnostics({
      env: ENV,
      fetch: fakeFetch({
        '/health': () => json(200, { ok: true, ready: true, bundle: 'ready' }),
        '/status': () => json(401, { error: 'unauthorized', message: 'Unauthorized' }),
        '/logs': () => json(401, { error: 'unauthorized', message: 'Unauthorized' }),
      }),
    });
    expect(d.health?.ok).toBe(true);
    expect(d.hints.join(' ')).toContain('token');
    expect(d.workerLogsError).toContain('unauthorized');
  });

  it('shows a failed bundle and memory pressure', async () => {
    const d = await getRemotionDiagnostics({
      env: ENV,
      fetch: fakeFetch({
        '/health': () => json(200, { ok: true, ready: false, bundle: 'failed' }),
        '/status': () =>
          json(200, {
            ok: true,
            bundleDetail: { state: 'failed', error: { message: 'webpack exploded' } },
            memory: { cgroup: { limitMb: 4096, currentMb: 3900 } },
            checks: { edgeTts: { found: false } },
            waiting: 20,
            maxQueue: 20,
          }),
        '/logs': () => json(200, { ok: true, entries: [] }),
      }),
    });
    const hints = d.hints.join('\n');
    expect(hints).toContain('webpack exploded');
    expect(hints).toContain('memory limit');
    expect(hints).toContain('edge-tts');
    expect(hints).toContain('queue is full');
  });

  it('returns logs, status and clip events for a healthy worker', async () => {
    recordClipEvent({ event: 'worker.error', level: 'warn', code: 'timeout' });
    const d = await getRemotionDiagnostics({
      env: ENV,
      fetch: fakeFetch({
        '/health': () => json(200, { ok: true, ready: true, bundle: 'ready' }),
        '/status': () => json(200, { ok: true, bundleDetail: { state: 'ready' } }),
        '/logs': () =>
          json(200, {
            ok: true,
            entries: [
              { id: 1, at: 't', level: 'info', event: 'bundle.ready', data: { ms: 9000 } },
              { id: 2, at: 't', level: 'warn', event: 'tts.fail', jobId: 'j1' },
            ],
          }),
      }),
    });
    expect(d.health).toMatchObject({ ok: true, ready: true, bundle: 'ready' });
    expect(d.workerLogs).toHaveLength(2);
    expect(d.workerLogs[0]).toMatchObject({ event: 'bundle.ready', data: '{"ms":9000}' });
    expect(d.clipEvents[0].data.code).toBe('timeout');
    expect(d.hints.join(' ')).toContain('Last clip problem');
  });
});
