import { render, screen } from '@testing-library/react';
import type { TStartupConfig } from 'librechat-data-provider';
import SocialLoginRender from '../SocialLoginRender';

const mockPasskeysSupported = jest.fn(() => true);

jest.mock('~/hooks/Auth/usePasskey', () => ({
  passkeysSupported: () => mockPasskeysSupported(),
}));

jest.mock('../PasskeySignIn', () => ({
  __esModule: true,
  default: ({ enabled }: { enabled: boolean }) =>
    enabled ? <button type="button" aria-label="Sign in with a passkey" /> : null,
}));

const config = (over: Partial<TStartupConfig>) =>
  ({
    emailLoginEnabled: true,
    socialLoginEnabled: true,
    socialLogins: ['openid'],
    openidLoginEnabled: false,
    passkeyLoginEnabled: false,
    serverDomain: 'https://chat.example.com',
    ...over,
  }) as TStartupConfig;

describe('SocialLoginRender', () => {
  beforeEach(() => {
    mockPasskeysSupported.mockReturnValue(true);
  });

  it('renders no "or" divider when the listed provider is not configured', () => {
    const { container } = render(<SocialLoginRender startupConfig={config({})} showPasskey />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the divider and the configured provider', () => {
    render(<SocialLoginRender startupConfig={config({ openidLoginEnabled: true })} />);
    expect(screen.getByText('Or')).toBeInTheDocument();
    expect(screen.getByRole('link')).toBeInTheDocument();
  });

  it('renders the passkey button alone when only passkeys are on', () => {
    render(<SocialLoginRender startupConfig={config({ passkeyLoginEnabled: true })} showPasskey />);
    expect(screen.getByText('Or')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with a passkey' })).toBeInTheDocument();
  });

  it('hides the passkey button when the browser has no WebAuthn (e.g. served over http)', () => {
    mockPasskeysSupported.mockReturnValue(false);
    const { container } = render(
      <SocialLoginRender startupConfig={config({ passkeyLoginEnabled: true })} showPasskey />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps the social providers when only the passkey button is hidden', () => {
    mockPasskeysSupported.mockReturnValue(false);
    render(
      <SocialLoginRender
        startupConfig={config({ passkeyLoginEnabled: true, openidLoginEnabled: true })}
        showPasskey
      />,
    );
    expect(screen.queryByRole('button', { name: 'Sign in with a passkey' })).toBeNull();
    expect(screen.getByRole('link')).toBeInTheDocument();
  });

  it('does not offer a passkey where the page did not ask for one (registration)', () => {
    render(<SocialLoginRender startupConfig={config({ passkeyLoginEnabled: true })} />);
    expect(screen.queryByRole('button', { name: 'Sign in with a passkey' })).toBeNull();
  });
});
