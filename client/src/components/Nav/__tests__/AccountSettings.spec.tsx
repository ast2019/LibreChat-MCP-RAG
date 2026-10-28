import { RecoilRoot } from 'recoil';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { act, render, screen } from '@testing-library/react';
import { listenForInstallPrompt, resetInstallState } from '~/components/Pwa/install';
import AccountSettings from '../AccountSettings';

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: {} }),
}));

jest.mock('~/hooks/AuthContext', () => ({
  useAuthContext: () => ({
    user: { name: 'Sara', email: 'sara@example.com', avatar: '' },
    logout: jest.fn(),
  }),
}));

jest.mock('~/components/Balance', () => ({
  __esModule: true,
  default: ({ className }: { className?: string }) => (
    <div data-testid="account-balance" className={className} />
  ),
}));

describe('AccountSettings', () => {
  it('shows the usage bar under the email when the menu opens', async () => {
    render(
      <MemoryRouter>
        <RecoilRoot>
          <AccountSettings />
        </RecoilRoot>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByTestId('nav-user'));

    const email = await screen.findByText('sara@example.com');
    const balance = screen.getByTestId('account-balance');
    expect(balance).toBeVisible();
    expect(email.compareDocumentPosition(balance) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('offers "Install app" once the browser allows installing, and opens its dialog', async () => {
    listenForInstallPrompt(window);
    resetInstallState();
    render(
      <MemoryRouter>
        <RecoilRoot>
          <AccountSettings />
        </RecoilRoot>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByTestId('nav-user'));
    expect(screen.queryByTestId('nav-install')).not.toBeInTheDocument();

    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: jest.fn(() => Promise.resolve()),
      userChoice: Promise.resolve({ outcome: 'dismissed', platform: 'web' }),
    });
    act(() => {
      window.dispatchEvent(event);
    });

    await userEvent.click(await screen.findByTestId('nav-install'));

    expect(await screen.findByTestId('pwa-install-confirm')).toBeInTheDocument();
    resetInstallState();
  });
});
