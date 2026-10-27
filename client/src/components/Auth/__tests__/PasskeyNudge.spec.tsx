import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from '@testing-library/react';
import type { PasskeyNudgeEligibility } from '../passkeyNudge';
import {
  passkeyNudgeStorageKey,
  shouldShowPasskeyNudge,
  canOfferPasskeyNudge,
  isPasskeyNudgeDismissed,
} from '../passkeyNudge';
import PasskeyNudge from '../PasskeyNudge';

const eligible: PasskeyNudgeEligibility = {
  passkeyLoginEnabled: true,
  supported: true,
  userId: 'user-1',
  provider: 'local',
  dismissed: false,
};

describe('shouldShowPasskeyNudge', () => {
  it('shows for an eligible password user with no passkeys', () => {
    expect(shouldShowPasskeyNudge(eligible, 0)).toBe(true);
  });

  it.each<[string, Partial<PasskeyNudgeEligibility>]>([
    ['passkeys are off on the server', { passkeyLoginEnabled: false }],
    ['startup config not loaded', { passkeyLoginEnabled: undefined }],
    ['the browser has no WebAuthn', { supported: false }],
    ['no signed-in user', { userId: undefined }],
    ['an identity-provider account', { provider: 'openid' }],
    ['the user chose "later"', { dismissed: true }],
  ])('hides when %s', (_label, over) => {
    expect(shouldShowPasskeyNudge({ ...eligible, ...over }, 0)).toBe(false);
  });

  it('hides when the user already has a passkey', () => {
    expect(shouldShowPasskeyNudge(eligible, 1)).toBe(false);
  });

  it('hides while the list is loading or failed', () => {
    expect(shouldShowPasskeyNudge(eligible, undefined)).toBe(false);
  });

  it('only fetches the list for users who could act on it', () => {
    expect(canOfferPasskeyNudge(eligible)).toBe(true);
    expect(canOfferPasskeyNudge({ ...eligible, provider: 'google' })).toBe(false);
  });
});

const mockRegisterPasskey = jest.fn();
const mockClearPasswordError = jest.fn();
let mockSupported = true;
let mockPasskeys: { passkeys: { id: string }[] } | undefined = { passkeys: [] };
let mockUser: { id: string; provider: string } | undefined = { id: 'user-1', provider: 'local' };
const mockQueryEnabled = jest.fn();

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: { passkeyLoginEnabled: true } }),
  usePasskeysQuery: (config: { enabled: boolean }) => {
    mockQueryEnabled(config.enabled);
    return { data: config.enabled ? mockPasskeys : undefined, isError: false };
  },
}));

jest.mock('~/hooks/Auth/usePasskey', () => ({
  passkeysSupported: () => mockSupported,
  usePasskeyRegistration: () => ({
    registerPasskey: mockRegisterPasskey,
    isRegistering: false,
    passwordErrorKey: null,
    clearPasswordError: mockClearPasswordError,
  }),
}));

jest.mock('~/hooks', () => ({
  useAuthContext: () => ({ user: mockUser }),
  useLocalize: () => (key: string) =>
    ({
      com_ui_passkey_nudge_title: 'Faster, safer sign-in with a passkey',
      com_ui_passkey_nudge_description: 'Sign in without a password.',
      com_ui_passkey_nudge_later: 'Later',
      com_ui_passkey_add: 'Add passkey',
      com_ui_passkey_confirm_password: 'Confirm your password',
      com_ui_passkey_confirm_password_description: 'Confirm before adding a passkey',
      com_ui_cancel: 'Cancel',
      com_ui_confirm: 'Confirm',
    })[key] ?? key,
}));

describe('PasskeyNudge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    mockSupported = true;
    mockPasskeys = { passkeys: [] };
    mockUser = { id: 'user-1', provider: 'local' };
  });

  it('invites a user with no passkeys and reports its visibility', () => {
    const onVisibilityChange = jest.fn();
    render(<PasskeyNudge onVisibilityChange={onVisibilityChange} />);
    expect(
      screen.getByRole('region', { name: 'Faster, safer sign-in with a passkey' }),
    ).toBeInTheDocument();
    expect(onVisibilityChange).toHaveBeenLastCalledWith(true);
  });

  it('stays hidden once the user has a passkey', () => {
    mockPasskeys = { passkeys: [{ id: 'pk-1' }] };
    render(<PasskeyNudge />);
    expect(screen.queryByTestId('passkey-nudge')).toBeNull();
  });

  it('stays hidden and skips the fetch where WebAuthn is unavailable', () => {
    mockSupported = false;
    render(<PasskeyNudge />);
    expect(screen.queryByTestId('passkey-nudge')).toBeNull();
    expect(mockQueryEnabled).toHaveBeenLastCalledWith(false);
  });

  it('"Later" hides it and remembers the choice for this user only', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<PasskeyNudge />);
    await user.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByTestId('passkey-nudge')).toBeNull();
    expect(window.localStorage.getItem(passkeyNudgeStorageKey('user-1'))).toBe('1');
    expect(isPasskeyNudgeDismissed('user-2')).toBe(false);
    unmount();

    render(<PasskeyNudge />);
    expect(screen.queryByTestId('passkey-nudge')).toBeNull();

    mockUser = { id: 'user-2', provider: 'local' };
    render(<PasskeyNudge />);
    expect(screen.getByTestId('passkey-nudge')).toBeInTheDocument();
  });

  it('"Add passkey" runs the shared enrollment dialog and hides after success', async () => {
    const user = userEvent.setup();
    mockRegisterPasskey.mockResolvedValue({ id: 'pk-new' });
    render(<PasskeyNudge />);

    await user.click(screen.getByRole('button', { name: 'Add passkey' }));
    const dialog = screen.getByRole('dialog', { name: 'Add passkey' });
    expect(dialog).toBeInTheDocument();

    await user.type(screen.getByLabelText('Confirm your password'), 'secret-pass');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(mockRegisterPasskey).toHaveBeenCalledWith('secret-pass');
    await waitFor(() => expect(screen.queryByTestId('passkey-nudge')).toBeNull());
    expect(screen.queryByRole('dialog', { name: 'Add passkey' })).toBeNull();
  });
});
