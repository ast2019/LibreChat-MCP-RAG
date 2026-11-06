import type { ChainHttp } from '~/web/chain/types';
import {
  OPENROUTER_CREDITS_URL,
  OPENROUTER_KEY_URL,
  probeOpenRouter,
  type ProbeContext,
} from './fetchers';

function http(routes: Record<string, { status: number; data: unknown }>): ChainHttp {
  return {
    async request<T>(init) {
      const route = routes[init.url];
      if (!route) {
        throw Object.assign(new Error(`unexpected ${init.url}`), { code: 'unexpected_url' });
      }
      if (route.status >= 400) {
        throw Object.assign(new Error(`HTTP ${route.status}`), {
          code: `http_${route.status}`,
          response: { status: route.status, data: route.data },
        });
      }
      return { status: route.status, data: route.data as T, headers: {} };
    },
  };
}

const ctx = (routes: Record<string, { status: number; data: unknown }>): ProbeContext => ({
  http: http(routes),
  timeoutMs: 1000,
});

describe('probeOpenRouter', () => {
  it('prefers the key spending cap over the account wallet', async () => {
    const probe = await probeOpenRouter(
      ctx({
        [OPENROUTER_CREDITS_URL]: {
          status: 200,
          data: { data: { total_credits: 50, total_usage: 5 } },
        },
        [OPENROUTER_KEY_URL]: {
          status: 200,
          data: {
            data: {
              limit: 10,
              limit_remaining: -0.04,
              usage: 10.04,
              usage_monthly: 10.04,
              limit_reset: null,
              expires_at: '2027-12-31T23:59:59Z',
              effective_budget: {
                resets_at: null,
                reset_interval: null,
              },
            },
          },
        },
      }),
      'sk-or-provision',
      'sk-or-management',
    );

    expect(probe).toMatchObject({
      configured: true,
      reachable: true,
      unit: 'usd',
      remaining: 0,
      limit: 10,
      usedThisPeriod: 10.04,
      plan: 'no_reset',
      quotaSource: 'key',
      accountRemaining: 45,
      accountLimit: 50,
      expiresAt: '2027-12-31T23:59:59Z',
    });
  });

  it('reports that a key has no expiry when expires_at is null', async () => {
    const probe = await probeOpenRouter(
      ctx({
        [OPENROUTER_CREDITS_URL]: { status: 403, data: {} },
        [OPENROUTER_KEY_URL]: {
          status: 200,
          data: {
            data: {
              limit: 10,
              limit_remaining: 4,
              usage: 6,
              usage_monthly: 6,
              limit_reset: 'monthly',
              expires_at: null,
            },
          },
        },
      }),
      'sk-or-provision',
    );

    expect(probe).toMatchObject({
      remaining: 4,
      limit: 10,
      expiresAt: null,
      plan: 'monthly',
    });
  });

  it('falls back to the account wallet when the key has no spending cap', async () => {
    const probe = await probeOpenRouter(
      ctx({
        [OPENROUTER_CREDITS_URL]: {
          status: 200,
          data: { data: { total_credits: 50, total_usage: 12.5 } },
        },
        [OPENROUTER_KEY_URL]: {
          status: 200,
          data: { data: { limit: null, limit_remaining: null, usage: 12.5, usage_monthly: 12.5 } },
        },
      }),
      'sk-or-provision',
      'sk-or-management',
    );

    expect(probe).toMatchObject({
      remaining: 37.5,
      limit: 50,
      usedThisPeriod: 12.5,
      quotaSource: 'account',
    });
    expect(probe.accountRemaining).toBeUndefined();
  });

  it('uses the key alone when credits require a management key', async () => {
    const probe = await probeOpenRouter(
      ctx({
        [OPENROUTER_CREDITS_URL]: {
          status: 403,
          data: { error: { message: 'Only management keys' } },
        },
        [OPENROUTER_KEY_URL]: {
          status: 200,
          data: {
            data: {
              limit: 100,
              limit_remaining: 74.5,
              usage: 25.5,
              usage_monthly: 25.5,
              limit_reset: 'monthly',
            },
          },
        },
      }),
      'sk-or-provision',
    );

    expect(probe).toMatchObject({
      remaining: 74.5,
      limit: 100,
      usedThisPeriod: 25.5,
      plan: 'monthly',
      quotaSource: 'key',
      accountRemaining: null,
    });
  });
});
