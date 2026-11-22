import { getPublicPacks } from './public';

describe('getPublicPacks', () => {
  it('lists only sellable credit packs, with their public classes and no admin note', () => {
    const packs = getPublicPacks({
      enabled: true,
      packs: [
        {
          id: 'starter',
          label: 'Starter',
          credits: 4_000_000,
          description: 'admin-only note',
          grants: { media: true, browser: true, attachVm: true },
          browserSessions: 2,
        },
        { id: 'claude', label: 'Claude', kind: 'time', durationDays: 30, endpoint: 'ClaudeTime' },
        { id: 'half', label: 'Half', credits: 1.5 },
        { id: 'none', label: 'None' },
        { id: 'pro', label: 'Pro', credits: 30_000_000, grants: { local: true } },
      ],
    });
    expect(packs).toEqual([
      {
        id: 'starter',
        label: 'Starter',
        credits: 4_000_000,
        includes: ['media', 'browser'],
        browserSessions: 2,
      },
      { id: 'pro', label: 'Pro', credits: 30_000_000, includes: ['local'] },
    ]);
    expect(JSON.stringify(packs)).not.toContain('admin-only note');
  });

  it('lists nothing while the balance is off', () => {
    expect(
      getPublicPacks({ enabled: false, packs: [{ id: 'a', label: 'A', credits: 1 }] }),
    ).toEqual([]);
    expect(getPublicPacks(undefined)).toEqual([]);
  });
});
