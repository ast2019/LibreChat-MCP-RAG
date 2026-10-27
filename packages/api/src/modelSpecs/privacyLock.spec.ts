import { checkSpecPrivacyLock } from './privacyLock';

const list = [
  { name: 'private-fast', privacy: 'private' as const },
  { name: 'private-smart', privacy: 'private' as const },
  { name: 'local', privacy: 'local' as const },
  { name: 'local-uncensored', privacy: 'local' as const },
  { name: 'normal' },
  { name: 'other-normal' },
];

describe('checkSpecPrivacyLock', () => {
  it('allows everything when no spec list is configured', () => {
    expect(
      checkSpecPrivacyLock({
        storedSpec: 'private-fast',
        requestedSpec: 'normal',
        list: [],
        hasMessages: true,
      }),
    ).toEqual({ allowed: true });
    expect(
      checkSpecPrivacyLock({
        storedSpec: 'private-fast',
        requestedSpec: 'normal',
        list: undefined,
        hasMessages: true,
      }),
    ).toEqual({ allowed: true });
  });

  it('keeps a private conversation on the same spec (regenerate/edit/continue)', () => {
    expect(
      checkSpecPrivacyLock({
        storedSpec: 'private-fast',
        requestedSpec: 'private-fast',
        list,
        hasMessages: true,
      }),
    ).toEqual({ allowed: true });
  });

  it.each([['private-smart'], ['local'], ['normal'], [null], [undefined]])(
    'R1: refuses switching a private conversation to %s',
    (requestedSpec) => {
      expect(
        checkSpecPrivacyLock({
          storedSpec: 'private-fast',
          requestedSpec,
          list,
          hasMessages: true,
        }),
      ).toEqual({ allowed: false, reason: 'private_locked' });
    },
  );

  it.each([['normal'], ['local'], [null], ['removed-spec']])(
    'R2: refuses switching a %s conversation into a private spec in place',
    (storedSpec) => {
      expect(
        checkSpecPrivacyLock({
          storedSpec,
          requestedSpec: 'private-fast',
          list,
          hasMessages: true,
        }),
      ).toEqual({ allowed: false, reason: 'private_requires_new_chat' });
    },
  );

  it.each([
    ['normal', 'other-normal'],
    ['normal', 'local'],
    ['local', 'local-uncensored'],
    ['local', 'normal'],
    [null, 'normal'],
  ])('allows switching a non-private conversation from %s to %s', (storedSpec, requestedSpec) => {
    expect(checkSpecPrivacyLock({ storedSpec, requestedSpec, list, hasMessages: true })).toEqual({
      allowed: true,
    });
  });

  it('gives an empty conversation a free choice', () => {
    expect(
      checkSpecPrivacyLock({
        storedSpec: 'normal',
        requestedSpec: 'private-fast',
        list,
        hasMessages: false,
      }),
    ).toEqual({ allowed: true });
    expect(
      checkSpecPrivacyLock({
        storedSpec: 'private-fast',
        requestedSpec: 'normal',
        list,
        hasMessages: false,
      }),
    ).toEqual({ allowed: true });
  });

  it('refuses a second model with another spec in a private turn', () => {
    expect(
      checkSpecPrivacyLock({
        storedSpec: 'private-fast',
        requestedSpec: 'private-fast',
        addedSpec: 'normal',
        list,
        hasMessages: true,
      }),
    ).toEqual({ allowed: false, reason: 'private_no_compare' });
    expect(
      checkSpecPrivacyLock({
        requestedSpec: 'private-fast',
        addedSpec: null,
        list,
        hasMessages: false,
      }),
    ).toEqual({ allowed: false, reason: 'private_no_compare' });
  });

  it('allows an added conversation on the same private spec or in non-private turns', () => {
    expect(
      checkSpecPrivacyLock({
        storedSpec: 'private-fast',
        requestedSpec: 'private-fast',
        addedSpec: 'private-fast',
        list,
        hasMessages: true,
      }),
    ).toEqual({ allowed: true });
    expect(
      checkSpecPrivacyLock({
        storedSpec: 'normal',
        requestedSpec: 'normal',
        addedSpec: 'local',
        list,
        hasMessages: true,
      }),
    ).toEqual({ allowed: true });
  });
});
