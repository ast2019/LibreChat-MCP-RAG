import { mediaImageSchema } from 'librechat-data-provider';
import type { ImageCatalogueModel } from './catalogue';
import {
  estimateImageUsd,
  listImageModels,
  resolveImageModel,
  matchesModelPattern,
} from './models';
import { createImageModelCatalogue } from './catalogue';

const image = mediaImageSchema.parse({
  model: 'openai/gpt-image-2',
  catalogue: true,
  persianText: ['openai/gpt-image-2*', 'google/gemini-*-image*'],
  exclude: ['recraft/*'],
  estimates: { 'google/gemini-3.1-flash-image': 0.08 },
  estimateTokens: 2000,
  estimateUsd: 0.1,
});

const catalogue: ImageCatalogueModel[] = [
  { id: 'black-forest-labs/flux.2-pro', name: 'FLUX.2 Pro', acceptsImages: true },
  { id: 'black-forest-labs/flux.2-max', name: 'FLUX.2 Max', acceptsImages: true },
  {
    id: 'google/gemini-3.1-flash-image',
    name: 'Nano Banana 2',
    imageOutputPrice: 0.00006,
    acceptsImages: true,
  },
  { id: 'openai/gpt-image-2', name: 'GPT Image 2', imageOutputPrice: 0.00003, acceptsImages: true },
  { id: 'recraft/recraft-v4', name: 'Recraft V4', acceptsImages: false },
];

describe('matchesModelPattern', () => {
  it('matches whole ids with * as any run of characters', () => {
    expect(matchesModelPattern('openai/gpt-image-2.5-flare', 'openai/gpt-image-2*')).toBe(true);
    expect(matchesModelPattern('openai/gpt-image-1', 'openai/gpt-image-2*')).toBe(false);
    expect(matchesModelPattern('google/gemini-3-pro-image', 'google/gemini-*-image*')).toBe(true);
    expect(matchesModelPattern('xgoogle/gemini-3-pro-image', 'google/gemini-*-image*')).toBe(false);
  });
});

describe('estimateImageUsd', () => {
  it('uses the configured estimate, then the token price, then the default', () => {
    expect(estimateImageUsd(image, 'google/gemini-3.1-flash-image', catalogue[2])).toBe(0.08);
    expect(estimateImageUsd(image, 'openai/gpt-image-2', catalogue[3])).toBeCloseTo(0.06);
    expect(estimateImageUsd(image, 'black-forest-labs/flux.2-pro', catalogue[0])).toBe(0.1);
  });
});

describe('listImageModels', () => {
  it('puts the default first, then Persian-text models, and drops excluded ones', () => {
    const ids = listImageModels(image, catalogue).map((model) => model.id);
    expect(ids).toEqual([
      'openai/gpt-image-2',
      'google/gemini-3.1-flash-image',
      'black-forest-labs/flux.2-max',
      'black-forest-labs/flux.2-pro',
    ]);
    expect(listImageModels(image, catalogue)[0]).toMatchObject({
      default: true,
      persianText: true,
    });
  });

  it('offers only the default when the catalogue is off or not read yet', () => {
    expect(listImageModels({ ...image, catalogue: false }, catalogue)).toHaveLength(1);
    expect(listImageModels(image, undefined)).toEqual([
      expect.objectContaining({ id: 'openai/gpt-image-2', default: true }),
    ]);
  });
});

describe('resolveImageModel', () => {
  const models = listImageModels(image, catalogue);

  it('takes the default for an empty request and an exact id or name', () => {
    expect(resolveImageModel(models, undefined)).toMatchObject({
      ok: true,
      model: { id: 'openai/gpt-image-2' },
    });
    expect(resolveImageModel(models, 'Nano Banana 2')).toMatchObject({
      ok: true,
      model: { id: 'google/gemini-3.1-flash-image' },
    });
  });

  it('accepts a loose name that matches one model, and asks back when it matches several', () => {
    expect(resolveImageModel(models, 'flux max')).toMatchObject({
      ok: true,
      model: { id: 'black-forest-labs/flux.2-max' },
    });
    expect(resolveImageModel(models, 'flux')).toEqual({
      ok: false,
      code: 'unknown_model',
      suggestions: ['black-forest-labs/flux.2-max', 'black-forest-labs/flux.2-pro'],
    });
  });

  it('refuses an excluded or unknown model', () => {
    expect(resolveImageModel(models, 'recraft/recraft-v4')).toMatchObject({ ok: false });
    expect(resolveImageModel(models, 'midjourney')).toEqual({
      ok: false,
      code: 'unknown_model',
      suggestions: [],
    });
  });
});

describe('image model catalogue', () => {
  const source = { baseURL: 'https://openrouter.ai/api/v1', apiKey: 'sk', timeoutMs: 1000 };

  it('reads image models, keeps their price, and leaves out routers and chat-only models', async () => {
    const fetchJson = jest.fn().mockResolvedValue({
      data: [
        {
          id: 'openai/gpt-image-2',
          name: 'GPT Image 2',
          pricing: { image_output: '0.00003' },
          architecture: { input_modalities: ['text', 'image'] },
          endpoints: ['/api/v1/images'],
        },
        { id: 'openrouter/auto', endpoints: ['/api/v1/images'] },
        { id: 'some/chat-only', endpoints: ['/api/v1/chat/completions'] },
      ],
    });
    const catalogueReader = createImageModelCatalogue({ fetchJson });
    await catalogueReader.refresh(source);
    expect(fetchJson).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/models?output_modalities=image',
      { headers: { Authorization: 'Bearer sk' }, timeout: 1000 },
    );
    expect(catalogueReader.getModels()).toEqual([
      {
        id: 'openai/gpt-image-2',
        name: 'GPT Image 2',
        imageOutputPrice: 0.00003,
        acceptsImages: true,
      },
    ]);
  });

  it('keeps the last list when a refresh fails', async () => {
    const fetchJson = jest
      .fn()
      .mockResolvedValueOnce({ data: [{ id: 'a/b', endpoints: ['/api/v1/images'] }] })
      .mockRejectedValueOnce(new Error('down'));
    const catalogueReader = createImageModelCatalogue({ fetchJson });
    await catalogueReader.refresh(source);
    await catalogueReader.refresh(source);
    expect(catalogueReader.getModels()).toEqual([{ id: 'a/b', acceptsImages: false }]);
  });
});
