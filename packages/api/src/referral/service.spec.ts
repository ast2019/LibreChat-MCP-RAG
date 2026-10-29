import { referralConfigSchema } from 'librechat-data-provider';
import type { ReferralDeps } from './service';
import {
  claimReferral,
  settleReferral,
  getReferralInfo,
  getReferralStartupConfig,
  REFERRAL_GRANT_CONTEXT,
  REFERRAL_WELCOME_CONTEXT,
} from './service';

const settings = referralConfigSchema.parse({
  enabled: true,
  referrerCredits: 500,
  inviteeCredits: 200,
  maxRewardsPerReferrer: 2,
});

/** An in-memory stand-in for the user and ledger methods. */
function fakeDeps(users: Record<string, { phoneVerified?: boolean; code?: string }>) {
  const referredBy: Record<string, string> = {};
  const rewarded = new Set<string>();
  const ledger: Array<{ user: string; context: string; rawAmount: number }> = [];
  const deps: ReferralDeps = {
    getOrCreateReferralCode: async (id) => users[id].code ?? 'ABCDEFGH',
    attachReferrer: async ({ inviteeId, code }) => {
      const referrer = Object.keys(users).find((id) => users[id].code === code);
      if (!referrer) {
        return { ok: false, reason: 'invalid_code' };
      }
      if (referrer === inviteeId) {
        return { ok: false, reason: 'self' };
      }
      if (referredBy[inviteeId]) {
        return { ok: false, reason: 'already_referred' };
      }
      referredBy[inviteeId] = referrer;
      return { ok: true, referrerId: referrer };
    },
    claimReferralReward: async (id) => {
      if (!referredBy[id] || rewarded.has(id)) {
        return null;
      }
      rewarded.add(id);
      return referredBy[id];
    },
    releaseReferralReward: async (id) => {
      rewarded.delete(id);
    },
    getReferralStats: async (referrer) => {
      const invitees = Object.keys(referredBy).filter((id) => referredBy[id] === referrer);
      return { invited: invitees.length, rewarded: invitees.filter((id) => rewarded.has(id)).length };
    },
    findUser: async (id) => (users[id] ? { id, phoneVerified: users[id].phoneVerified } : null),
    createTransaction: async (tx) => {
      ledger.push({ user: tx.user, context: tx.context, rawAmount: tx.rawAmount });
      return { balance: tx.rawAmount };
    },
  };
  return { deps, ledger, rewarded };
}

describe('referral rewards', () => {
  it('pays both sides once, under separate ledger contexts', async () => {
    const { deps, ledger } = fakeDeps({
      alice: { code: 'ALICE234' },
      bob: { phoneVerified: true },
    });

    await expect(claimReferral(deps, settings, { userId: 'bob', code: 'ALICE234' })).resolves.toEqual({
      status: 'rewarded',
      credits: 200,
    });
    await expect(claimReferral(deps, settings, { userId: 'bob', code: 'ALICE234' })).resolves.toEqual({
      status: 'already_referred',
    });
    expect(ledger).toEqual([
      { user: 'bob', context: REFERRAL_WELCOME_CONTEXT, rawAmount: 200 },
      { user: 'alice', context: REFERRAL_GRANT_CONTEXT, rawAmount: 500 },
    ]);
  });

  it('waits for a verified mobile, then pays when it is settled again', async () => {
    const users = { alice: { code: 'ALICE234' }, bob: { phoneVerified: false } };
    const { deps, ledger } = fakeDeps(users);

    await expect(claimReferral(deps, settings, { userId: 'bob', code: 'ALICE234' })).resolves.toEqual({
      status: 'pending_phone',
    });
    expect(ledger).toEqual([]);

    users.bob.phoneVerified = true;
    await expect(settleReferral(deps, settings, 'bob')).resolves.toMatchObject({ status: 'rewarded' });
    expect(ledger).toHaveLength(2);
  });

  it('refuses a self-invite and an unknown code', async () => {
    const { deps, ledger } = fakeDeps({ alice: { code: 'ALICE234', phoneVerified: true } });

    await expect(claimReferral(deps, settings, { userId: 'alice', code: 'ALICE234' })).resolves.toEqual({
      status: 'self',
    });
    await expect(claimReferral(deps, settings, { userId: 'alice', code: 'ZZZZZZZZ' })).resolves.toEqual({
      status: 'invalid_code',
    });
    expect(ledger).toEqual([]);
  });

  it('stops paying the inviter past the cap but still welcomes the invitee', async () => {
    const { deps, ledger } = fakeDeps({
      alice: { code: 'ALICE234' },
      b1: { phoneVerified: true },
      b2: { phoneVerified: true },
      b3: { phoneVerified: true },
    });
    for (const id of ['b1', 'b2']) {
      await claimReferral(deps, settings, { userId: id, code: 'ALICE234' });
    }
    await expect(claimReferral(deps, settings, { userId: 'b3', code: 'ALICE234' })).resolves.toEqual({
      status: 'capped',
      credits: 200,
    });
    expect(ledger.filter((tx) => tx.user === 'alice')).toHaveLength(2);
    expect(ledger.filter((tx) => tx.user === 'b3')).toHaveLength(1);
  });

  it('releases the claim when the ledger write fails, so it can be retried', async () => {
    const { deps, rewarded } = fakeDeps({ alice: { code: 'ALICE234' }, bob: { phoneVerified: true } });
    deps.createTransaction = async () => undefined;

    await expect(claimReferral(deps, settings, { userId: 'bob', code: 'ALICE234' })).rejects.toThrow();
    expect(rewarded.has('bob')).toBe(false);
  });

  it('does nothing while off and tells the client nothing', async () => {
    const off = referralConfigSchema.parse({});
    const { deps } = fakeDeps({ alice: { code: 'ALICE234' }, bob: { phoneVerified: true } });

    await expect(claimReferral(deps, off, { userId: 'bob', code: 'ALICE234' })).resolves.toEqual({
      status: 'disabled',
    });
    expect(getReferralStartupConfig({ config: {} } as never)).toBeUndefined();
    expect(getReferralStartupConfig({ config: { referral: { enabled: true } } } as never)).toEqual({
      enabled: true,
      referrerCredits: 500_000,
      inviteeCredits: 200_000,
    });
  });

  it('builds the sign-up link on the client origin', async () => {
    const { deps } = fakeDeps({ alice: { code: 'ALICE234' } });
    const info = await getReferralInfo(deps, settings, {
      userId: 'alice',
      clientOrigin: 'https://chat.example.com',
    });
    expect(info.link).toBe('https://chat.example.com/register?ref=ALICE234');
    expect(info).toMatchObject({ code: 'ALICE234', invited: 0, rewarded: 0, maxRewards: 2 });
  });
});
