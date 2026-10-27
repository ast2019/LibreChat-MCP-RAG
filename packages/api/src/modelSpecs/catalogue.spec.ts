import type { AppConfig } from '@librechat/data-schemas';
import {
  modelAcceptsFiles,
  modelAcceptsImages,
  createModelCatalogue,
  resolveModelCatalogueSource,
} from './catalogue';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

const source = { baseURL: 'https://openrouter.test/api/v1', apiKey: 'sk', timeoutMs: 1000 };
const modelsBody = {
  data: [
    { id: 'anthropic/claude-sonnet-5.5', name: 'Anthropic: Claude Sonnet 5.5', created: 2, x: 1 },
    { id: '~anthropic/claude-sonnet-latest', name: 'Anthropic: Claude Sonnet Latest' },
  ],
};
const zdrBody = { data: [{ model_id: 'anthropic/claude-sonnet-5.5', provider_name: 'Anthropic' }] };

function fetchJsonFor(responses: Record<string, unknown | Error>) {
  return jest.fn(async (url: string) => {
    const key = url.endsWith('/endpoints/zdr') ? 'zdr' : 'models';
    const response = responses[key];
    if (response instanceof Error) {
      throw response;
    }
    return response;
  });
}

describe('createModelCatalogue', () => {
  it('has no snapshot before the first fetch, then both lists', async () => {
    const fetchJson = fetchJsonFor({ models: modelsBody, zdr: zdrBody });
    const catalogue = createModelCatalogue({ fetchJson });
    expect(catalogue.getSnapshot()).toBeUndefined();

    await catalogue.refresh(source);
    const snapshot = catalogue.getSnapshot();
    expect(snapshot?.models).toEqual([
      { id: 'anthropic/claude-sonnet-5.5', name: 'Anthropic: Claude Sonnet 5.5', created: 2 },
      { id: '~anthropic/claude-sonnet-latest', name: 'Anthropic: Claude Sonnet Latest' },
    ]);
    expect([...(snapshot?.zdr ?? [])]).toEqual(['anthropic/claude-sonnet-5.5']);
    expect(fetchJson).toHaveBeenCalledWith('https://openrouter.test/api/v1/models', {
      headers: { Authorization: 'Bearer sk' },
      timeout: 1000,
    });
    expect(fetchJson).toHaveBeenCalledWith(
      'https://openrouter.test/api/v1/endpoints/zdr',
      expect.objectContaining({ timeout: 1000 }),
    );
  });

  it('keeps the last list when a refresh fails, and treats an empty ZDR list as a failure', async () => {
    const responses: Record<string, unknown> = { models: modelsBody, zdr: zdrBody };
    const catalogue = createModelCatalogue({ fetchJson: fetchJsonFor(responses) });
    await catalogue.refresh(source);
    const first = catalogue.getSnapshot();

    responses.zdr = { data: [] };
    responses.models = new Error('timeout');
    await catalogue.refresh(source);
    expect(catalogue.getSnapshot()).toBe(first);

    responses.models = { data: [{ id: 'a/b-1' }] };
    await catalogue.refresh(source);
    const next = catalogue.getSnapshot();
    expect(next?.version).toBe((first?.version ?? 0) + 1);
    expect(next?.models).toEqual([{ id: 'a/b-1' }]);
    expect(next?.zdr).toBe(first?.zdr);
  });

  it('never rejects and leaves ZDR unknown when only it fails', async () => {
    const catalogue = createModelCatalogue({
      fetchJson: fetchJsonFor({ models: modelsBody, zdr: { nope: true } }),
    });
    await expect(catalogue.refresh(source)).resolves.toBeUndefined();
    expect(catalogue.getSnapshot()?.zdr).toBeNull();
    expect(catalogue.getSnapshot()?.models).toHaveLength(2);
  });

  it('refreshes on an unref’d interval until stopped', async () => {
    jest.useFakeTimers();
    try {
      const fetchJson = fetchJsonFor({ models: modelsBody, zdr: zdrBody });
      const catalogue = createModelCatalogue({ fetchJson });
      await catalogue.start(source, 60_000);
      expect(fetchJson).toHaveBeenCalledTimes(2);
      await jest.advanceTimersByTimeAsync(60_000);
      expect(fetchJson).toHaveBeenCalledTimes(4);
      catalogue.stop();
      await jest.advanceTimersByTimeAsync(120_000);
      expect(fetchJson).toHaveBeenCalledTimes(4);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('resolveModelCatalogueSource', () => {
  const config = (endpoint: Record<string, unknown>, enabled = true) =>
    ({
      endpoints: { custom: [{ name: 'OpenRouter', ...endpoint }] },
      modelSpecs: { list: [], autoDiscover: { enabled, endpoint: 'OpenRouter', timeoutMs: 5000 } },
    }) as unknown as AppConfig;

  beforeEach(() => {
    process.env.TEST_CATALOGUE_KEY = 'sk-env';
  });
  afterEach(() => {
    delete process.env.TEST_CATALOGUE_KEY;
  });

  it('reads the endpoint base URL and resolved key', () => {
    expect(
      resolveModelCatalogueSource(
        config({ baseURL: 'https://openrouter.ai/api/v1/', apiKey: '${TEST_CATALOGUE_KEY}' }),
      ),
    ).toEqual({ baseURL: 'https://openrouter.ai/api/v1', apiKey: 'sk-env', timeoutMs: 5000 });
  });

  it('omits keys the deployment does not hold and refuses unusable sources', () => {
    expect(
      resolveModelCatalogueSource(
        config({ baseURL: 'https://openrouter.ai/api/v1', apiKey: 'user_provided' }),
      ),
    ).toEqual({ baseURL: 'https://openrouter.ai/api/v1', timeoutMs: 5000 });
    expect(resolveModelCatalogueSource(config({ baseURL: '${UNSET_CATALOGUE_URL}' }))).toBeNull();
    expect(resolveModelCatalogueSource(config({ baseURL: 'https://x' }, false))).toBeNull();
    expect(resolveModelCatalogueSource(null)).toBeNull();
  });
});

describe('modelAcceptsFiles / modelAcceptsImages', () => {
  const body = {
    data: [
      {
        id: 'google/gemini-3.8-flash',
        architecture: { input_modalities: ['text', 'image', 'file', 'audio'], modality: 'x' },
      },
      { id: '~google/gemini-flash-latest', architecture: { input_modalities: ['text', 'file'] } },
      { id: 'deepseek/deepseek-v4', architecture: { input_modalities: ['text'] } },
      { id: 'x/no-architecture' },
      { id: 'x/bad-modalities', architecture: { input_modalities: 'text' } },
    ],
  };

  async function snapshotOf(models: unknown) {
    const catalogue = createModelCatalogue({ fetchJson: fetchJsonFor({ models, zdr: zdrBody }) });
    await catalogue.refresh(source);
    return catalogue.getSnapshot();
  }

  it('keeps the input modalities of each model', async () => {
    const snapshot = await snapshotOf(body);
    expect(snapshot?.models?.[0]).toEqual({
      id: 'google/gemini-3.8-flash',
      inputModalities: ['text', 'image', 'file', 'audio'],
    });
    expect(snapshot?.models?.[3]).toEqual({ id: 'x/no-architecture' });
    expect(snapshot?.models?.[4]).toEqual({ id: 'x/bad-modalities' });
  });

  it('answers from the catalogue, aliases included, and undefined when unknown', async () => {
    const snapshot = await snapshotOf(body);
    expect(modelAcceptsFiles('google/gemini-3.8-flash', snapshot)).toBe(true);
    expect(modelAcceptsImages('google/gemini-3.8-flash', snapshot)).toBe(true);
    expect(modelAcceptsFiles('~google/gemini-flash-latest', snapshot)).toBe(true);
    expect(modelAcceptsImages('~google/gemini-flash-latest', snapshot)).toBe(false);
    expect(modelAcceptsFiles('deepseek/deepseek-v4', snapshot)).toBe(false);
    expect(modelAcceptsFiles('deepseek/deepseek-v4:free', snapshot)).toBe(false);
    expect(modelAcceptsFiles('x/no-architecture', snapshot)).toBeUndefined();
    expect(modelAcceptsFiles('x/bad-modalities', snapshot)).toBeUndefined();
    expect(modelAcceptsFiles('x/unlisted', snapshot)).toBeUndefined();
    expect(modelAcceptsFiles('google/gemini-3.8-flash', undefined)).toBeUndefined();
    expect(modelAcceptsFiles('', snapshot)).toBeUndefined();
  });
});
