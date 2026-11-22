import type { MediaBilling } from '~/media/billing';
import type { ServerRequest } from '~/types';
import { createClipImageService } from './images';

const appConfig = {
  config: {
    mediaGeneration: {
      enabled: true,
      paidOnly: true,
      endpoint: 'OpenRouter',
      image: { model: 'google/image', estimateUsd: 0.1 },
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

function setup({ packId = 'starter' as string | null, balance = 1_000_000 } = {}) {
  let available = balance;
  const releases: jest.Mock[] = [];
  const billing: MediaBilling = {
    hold: jest.fn(async (_req, _charge, credits: number) => {
      if (credits > available) {
        return 'insufficient' as const;
      }
      available -= credits;
      const release = jest.fn(async () => {
        available += credits;
      });
      releases.push(release);
      return { release };
    }),
    record: jest.fn(async () => undefined),
  };
  const fetch = jest.fn(
    async () =>
      new Response(
        JSON.stringify({ data: [{ b64_json: Buffer.from('png').toString('base64'), media_type: 'image/png' }], usage: { cost: 0.04 } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  );
  const pack = { packId };
  const findBalanceByUser = jest.fn(async () => pack);
  const service = createClipImageService({ billing, findBalanceByUser, fetch });
  return {
    service,
    billing,
    fetch,
    pack,
    spend: (credits: number) => {
      available -= credits;
    },
    held: () => balance - available,
  };
}

describe('clip AI images', () => {
  it('keeps the tool-time hold on the job until its images are generated', async () => {
    const { service, held } = setup();
    const reserved = await service.reserve(req, 2);
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) {
      return;
    }
    reserved.hold.keep('job1', Date.now() + 60_000);
    /** Two images at $0.10 with the 1.5 markup. */
    expect(held()).toBe(300_000);
    const first = await service.generate(req, 'wind farm', '9:16', { jobId: 'job1' });
    expect(first).toMatchObject({ ok: true, credits: 60_000 });
    /** One image's share was released; the second is still held. */
    expect(held()).toBe(150_000);
    await service.release('job1');
    expect(held()).toBe(0);
  });

  it('a user who spent the credit since the tool call gets no image and no charge', async () => {
    const { service, billing, fetch, spend } = setup({ balance: 200_000 });
    const reserved = await service.reserve(req, 1);
    if (!reserved.ok) {
      throw new Error('expected a hold');
    }
    /** The job's hold expired with a restart, and the credit went elsewhere. */
    await reserved.hold.release();
    spend(150_000);
    const result = await service.generate(req, 'wind farm', '9:16', { jobId: 'job2' });
    expect(result).toEqual({ ok: false, code: 'insufficient_credit' });
    expect(fetch).not.toHaveBeenCalled();
    expect(billing.record).not.toHaveBeenCalled();
  });

  it('access is checked again at generation (a user moved off a paid pack)', async () => {
    const { service, billing, fetch, pack } = setup();
    expect((await service.reserve(req, 1)).ok).toBe(true);
    pack.packId = null;
    const result = await service.generate(req, 'wind farm', '9:16');
    expect(result).toEqual({ ok: false, code: 'not_allowed' });
    expect(fetch).not.toHaveBeenCalled();
    expect(billing.record).not.toHaveBeenCalled();
  });

  it('a provider failure charges nothing and releases the image hold', async () => {
    const { service, billing, fetch, held } = setup();
    fetch.mockResolvedValueOnce(new Response('{"error":"down"}', { status: 500 }));
    await expect(service.generate(req, 'wind farm', '9:16')).rejects.toThrow();
    expect(billing.record).not.toHaveBeenCalled();
    expect(held()).toBe(0);
  });
});
