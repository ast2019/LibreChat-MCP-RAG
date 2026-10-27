import type { FetchLike, VisionEndpoint } from './vision';
import {
  createOpenAICompatibleVisionCaller,
  cleanTranscription,
  OCR_SYSTEM_PROMPT,
} from './vision';

type FetchCall = Parameters<FetchLike>;

const ENDPOINTS: Record<string, VisionEndpoint> = {
  OpenRouterPrivate: {
    baseURL: 'https://openrouter.ai/api/v1/',
    apiKey: 'sk-test',
    addParams: { provider: { zdr: true, data_collection: 'deny' }, temperature: 0.7 },
  },
  Local: { baseURL: 'http://ollama:11434/v1', apiKey: '' },
};

function jsonResponse(status: number, body: unknown): Awaited<ReturnType<FetchLike>> {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function setup(responses: Array<Awaited<ReturnType<FetchLike>>>) {
  const calls: FetchCall[] = [];
  const fetch: FetchLike = async (...args) => {
    calls.push(args);
    const next = responses.shift();
    if (!next) {
      throw new Error('network down');
    }
    return next;
  };
  const caller = createOpenAICompatibleVisionCaller({
    resolveEndpoint: (name) => ENDPOINTS[name],
    timeoutMs: 5000,
    retryDelayMs: 0,
    fetch,
  });
  return { caller, calls };
}

const ok = (content: unknown, usage?: Record<string, number>) =>
  jsonResponse(200, { choices: [{ message: { content } }], ...(usage ? { usage } : {}) });

const image = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe('createOpenAICompatibleVisionCaller', () => {
  it('sends an OCR request with the endpoint addParams (ZDR) merged in', async () => {
    const { caller, calls } = setup([
      ok('# عنوان\n\nمتن صفحه', { prompt_tokens: 1290, completion_tokens: 37 }),
    ]);

    const response = await caller({
      endpoint: 'OpenRouterPrivate',
      model: 'google/gemini-3.8-flash',
      image,
      mimetype: 'image/png',
    });

    expect(response).toEqual({
      text: '# عنوان\n\nمتن صفحه',
      promptTokens: 1290,
      completionTokens: 37,
      estimated: false,
    });
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer sk-test',
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      model: 'google/gemini-3.8-flash',
      temperature: 0,
      provider: { zdr: true, data_collection: 'deny' },
      usage: { include: true },
    });
    expect(body.messages[0]).toEqual({ role: 'system', content: OCR_SYSTEM_PROMPT });
    expect(body.messages[1].role).toBe('user');
    expect(body.messages[1].content[1]).toEqual({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${image.toString('base64')}` },
    });
  });

  it('asks for exact, untranslated, RTL-correct transcription', () => {
    expect(OCR_SYSTEM_PROMPT).toMatch(/exactly as written/);
    expect(OCR_SYSTEM_PROMPT).toMatch(/Do not translate/);
    expect(OCR_SYSTEM_PROMPT).toMatch(/logical/);
    expect(OCR_SYSTEM_PROMPT).toMatch(/Markdown tables/);
    expect(OCR_SYSTEM_PROMPT).toMatch(/empty string/);
  });

  it('omits OpenRouter-only fields and auth for other endpoints', async () => {
    const { caller, calls } = setup([ok('x', { prompt_tokens: 1, completion_tokens: 1 })]);
    await caller({ endpoint: 'Local', model: 'qwen2.5vl', image, mimetype: 'image/jpeg' });
    const body = JSON.parse(calls[0][1].body);
    expect(body.usage).toBeUndefined();
    expect(calls[0][1].headers.Authorization).toBeUndefined();
    expect(body.messages[1].content[1].image_url.url.startsWith('data:image/jpeg;base64,')).toBe(
      true,
    );
  });

  it('estimates and flags usage when the provider returns none', async () => {
    const { caller } = setup([ok([{ type: 'text', text: 'سلام دنیا' }])]);
    const response = await caller({
      endpoint: 'Local',
      model: 'm',
      image,
      mimetype: 'image/png',
    });
    expect(response).toEqual({
      text: 'سلام دنیا',
      promptTokens: 1500,
      completionTokens: 5,
      estimated: true,
    });
  });

  it('retries once on 5xx, then succeeds', async () => {
    const { caller, calls } = setup([
      jsonResponse(502, { error: 'secret upstream detail' }),
      ok('ok', { prompt_tokens: 2, completion_tokens: 3 }),
    ]);
    const response = await caller({ endpoint: 'Local', model: 'm', image, mimetype: 'image/png' });
    expect(calls).toHaveLength(2);
    expect(response.completionTokens).toBe(3);
  });

  it('fails without retry on 4xx and never leaks the provider payload', async () => {
    const { caller, calls } = setup([jsonResponse(400, { error: 'secret upstream detail' })]);
    const error = await caller({
      endpoint: 'Local',
      model: 'm',
      image,
      mimetype: 'image/png',
    }).catch((e: Error) => e);
    expect(calls).toHaveLength(1);
    expect(error).toMatchObject({ code: 'vision_failed' });
    expect((error as Error).message).toBe('Vision OCR request failed with status 400');
  });

  it('reports network failures after retries', async () => {
    const { caller, calls } = setup([]);
    await expect(
      caller({ endpoint: 'Local', model: 'm', image, mimetype: 'image/png' }),
    ).rejects.toMatchObject({ code: 'vision_failed' });
    expect(calls).toHaveLength(2);
  });

  it('rejects unknown endpoints', async () => {
    const { caller } = setup([]);
    await expect(
      caller({ endpoint: 'Nope', model: 'm', image, mimetype: 'image/png' }),
    ).rejects.toMatchObject({ code: 'endpoint_not_found' });
  });

  it('maps a caller abort to `aborted`', async () => {
    const controller = new AbortController();
    const caller = createOpenAICompatibleVisionCaller({
      resolveEndpoint: (name) => ENDPOINTS[name],
      timeoutMs: 5000,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
          controller.abort();
        }),
    });
    await expect(
      caller({
        endpoint: 'Local',
        model: 'm',
        image,
        mimetype: 'image/png',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'aborted' });
  });

  it('maps the per-call timeout to `timeout`', async () => {
    const caller = createOpenAICompatibleVisionCaller({
      resolveEndpoint: (name) => ENDPOINTS[name],
      timeoutMs: 20,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('timeout')));
        }),
    });
    await expect(
      caller({ endpoint: 'Local', model: 'm', image, mimetype: 'image/png' }),
    ).rejects.toMatchObject({ code: 'timeout' });
  });
});

describe('cleanTranscription', () => {
  it('strips code fences and empty-string answers', () => {
    expect(cleanTranscription('```markdown\n| الف | ب |\n|---|---|\n```')).toBe(
      '| الف | ب |\n|---|---|',
    );
    expect(cleanTranscription(' "" ')).toBe('');
    expect(cleanTranscription('  متن  ')).toBe('متن');
  });
});
