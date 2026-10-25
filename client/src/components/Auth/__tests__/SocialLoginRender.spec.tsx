import { render, screen } from '@testing-library/react';
import type { TStartupConfig } from 'librechat-data-provider';
import SocialLoginRender from '../SocialLoginRender';

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
});
