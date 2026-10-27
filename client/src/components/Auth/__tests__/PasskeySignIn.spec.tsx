import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import PasskeySignIn from '../PasskeySignIn';

const mockSignIn = jest.fn();
let mockIsSigningIn = false;

jest.mock('~/hooks/Auth/usePasskey', () => ({
  usePasskeySignIn: () => ({ signIn: mockSignIn, isSigningIn: mockIsSigningIn }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) =>
    ({ com_auth_passkey_login_biometric: 'ورود با کلید عبور (اثر انگشت / چهره)' })[key] ?? key,
}));

describe('PasskeySignIn', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsSigningIn = false;
  });

  it('renders nothing when disabled', () => {
    const { container } = render(<PasskeySignIn enabled={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers a full-width button named after the gesture and starts the ceremony', async () => {
    const user = userEvent.setup();
    render(<PasskeySignIn enabled />);
    const button = screen.getByRole('button', { name: 'ورود با کلید عبور (اثر انگشت / چهره)' });
    expect(button).toHaveClass('w-full');
    await user.click(button);
    expect(mockSignIn).toHaveBeenCalledTimes(1);
  });

  it('is busy and disabled while a ceremony runs', () => {
    mockIsSigningIn = true;
    render(<PasskeySignIn enabled />);
    const button = screen.getByTestId('passkey');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });
});
