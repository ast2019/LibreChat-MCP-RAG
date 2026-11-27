import type { MediaBilling } from '~/media/billing';
import type { SpeechProviderClient } from '~/speech/types';
import type { ServerRequest } from '~/types';
import { chunkNarration, createClipNarrationService } from './narration';

const appConfig = {
  config: {
    mediaGeneration: {
      enabled: true,
      paidOnly: true,
      endpoint: 'OpenRouter',
      speech: {
        model: 'default/tts',
        voice: 'Kore',
        format: 'pcm',
        estimateUsd: 0.1,
        maxChars: 50,
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
        priceMultiplier: 1.5,
      },
    ],
  },
};

const req = { user: { id: 'u1' }, config: appConfig } as unknown as ServerRequest;
const voice = { voice: 'Charon', model: 'google/gemini-3.8-flash-tts' };

function setup({
  packId = 'starter' as string | null,
  balance = 1_000_000,
  costUsd = 0.04 as number | null,
} = {}) {
  let available = balance;
  const billing: MediaBilling = {
    hold: jest.fn(async (_req, _charge, credits: number) => {
      if (credits > available) {
        return 'insufficient' as const;
      }
      available -= credits;
      return {
        release: jest.fn(async () => {
          available += credits;
        }),
      };
    }),
    record: jest.fn(async () => undefined),
  };
  const speechClient: SpeechProviderClient = {
    transcribe: jest.fn(),
    synthesize: jest.fn(async () => ({
      audio: Buffer.alloc(480),
      generationId: costUsd === null ? undefined : 'gen-1',
    })),
    getGenerationCost: jest.fn(async () => costUsd ?? undefined),
  };
  const pack = { packId };
  const service = createClipNarrationService({
    billing,
    findBalanceByUser: jest.fn(async () => pack),
    speechClient,
  });
  return {
    service,
    billing,
    speechClient,
    pack,
    spend: (n: number) => {
      available -= n;
    },
    held: () => balance - available,
  };
}

describe('chunkNarration', () => {
  it('keeps short text whole and splits long text at sentences or spaces', () => {
    expect(chunkNarration('  hello  ', 50)).toEqual(['hello']);
    expect(chunkNarration('', 50)).toEqual([]);
    const parts = chunkNarration(
      'First sentence here. Second sentence follows now. Third one ends.',
      40,
    );
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => part.length <= 40)).toBe(true);
    expect(parts.join(' ')).toBe(
      'First sentence here. Second sentence follows now. Third one ends.',
    );
  });
});

describe('clip narration service', () => {
  it('holds per speech call at tool time, speaks with the chosen voice and charges once per scene', async () => {
    const { service, billing, speechClient, held } = setup();
    const reserved = await service.reserve(req, ['one line', 'two line']);
    if (!reserved.ok) {
      throw new Error('expected a hold');
    }
    reserved.hold.keep('job1', Date.now() + 60_000);
    /** $0.10 at the 1.5 markup, two scenes. */
    expect(held()).toBe(300_000);
    const first = await service.generate(req, 'one line', voice, { jobId: 'job1' });
    /** The provider cost ($0.04) wins over the estimate. */
    expect(first).toMatchObject({ ok: true, type: 'audio/wav', credits: 60_000 });
    expect(billing.record).toHaveBeenCalledTimes(1);
    expect(speechClient.synthesize).toHaveBeenCalledWith(
      expect.objectContaining({
        voice: 'Charon',
        responseFormat: 'pcm',
        target: expect.objectContaining({ model: 'google/gemini-3.8-flash-tts' }),
      }),
    );
    /** The first scene's share was swapped for its own hold and released after the call. */
    expect(held()).toBe(150_000);
    await service.release('job1');
    expect(held()).toBe(0);
    const wav = (first as { buffer: Buffer }).buffer;
    expect(wav.subarray(0, 4).toString()).toBe('RIFF');
  });

  it('charges the estimate when the provider reports no cost', async () => {
    const { service } = setup({ costUsd: null });
    expect(await service.generate(req, 'hello', voice)).toMatchObject({
      ok: true,
      credits: 150_000,
    });
  });

  it('speaks text over maxChars in pieces, one charge each', async () => {
    const { service, billing, speechClient } = setup();
    const text = 'Word '.repeat(25).trim();
    const result = await service.generate(req, text, voice);
    expect(result.ok).toBe(true);
    expect((speechClient.synthesize as jest.Mock).mock.calls.length).toBeGreaterThan(1);
    expect((billing.record as jest.Mock).mock.calls.length).toBe(
      (speechClient.synthesize as jest.Mock).mock.calls.length,
    );
  });

  it('refuses at tool time when credit does not cover the lines, and holds nothing', async () => {
    const { service, held } = setup({ balance: 200_000 });
    const reserved = await service.reserve(req, ['a', 'b']);
    expect(reserved.ok).toBe(false);
    expect(held()).toBe(0);
  });

  it('refuses at tool time when the pack does not allow media', async () => {
    const { service } = setup({ packId: null });
    const reserved = await service.reserve(req, ['a']);
    expect(reserved).toMatchObject({ ok: false });
    expect((reserved as { message: string }).message).toContain('paid packs');
  });

  it('reports an unconfigured deployment', async () => {
    const { service } = setup();
    const bare = { user: { id: 'u1' }, config: { config: {} } } as unknown as ServerRequest;
    expect(await service.reserve(bare, ['a'])).toMatchObject({ ok: false });
    expect(await service.generate(bare, 'a', voice)).toEqual({ ok: false, code: 'unconfigured' });
  });

  it('access and balance are checked again at generation and refusals charge nothing', async () => {
    const { service, billing, speechClient, pack, spend } = setup({ balance: 200_000 });
    pack.packId = null;
    expect(await service.generate(req, 'a', voice)).toEqual({ ok: false, code: 'not_allowed' });
    pack.packId = 'starter';
    spend(100_000);
    expect(await service.generate(req, 'a', voice)).toEqual({
      ok: false,
      code: 'insufficient_credit',
    });
    expect(speechClient.synthesize).not.toHaveBeenCalled();
    expect(billing.record).not.toHaveBeenCalled();
  });

  it('a provider failure charges nothing and releases the hold', async () => {
    const { service, billing, speechClient, held } = setup();
    (speechClient.synthesize as jest.Mock).mockRejectedValueOnce(new Error('down'));
    await expect(service.generate(req, 'hello', voice)).rejects.toThrow();
    expect(billing.record).not.toHaveBeenCalled();
    expect(held()).toBe(0);
  });
});
