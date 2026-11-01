import { RecoilRoot } from 'recoil';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { act, render, screen } from '@testing-library/react';
import type { TBalanceResponse } from 'librechat-data-provider';
import type { BalanceView } from '~/hooks/useBalanceSummary';
import { listenForInstallPrompt, resetInstallState } from '~/components/Pwa/install';
import AccountSettings from '../AccountSettings';
import { summarizeBalance } from '~/utils';

const mockBalanceView = jest.fn<BalanceView, []>();

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: {} }),
}));

jest.mock('~/hooks/AuthContext', () => ({
  useAuthContext: () => ({
    user: { name: 'Sara', email: 'sara@example.com', avatar: '' },
    logout: jest.fn(),
  }),
}));

jest.mock('~/hooks/useBalanceSummary', () => ({
  __esModule: true,
  default: () => mockBalanceView(),
}));

jest.mock('~/components/Balance', () => ({
  __esModule: true,
  default: ({ className }: { className?: string }) => (
    <div data-testid="account-balance" className={className} />
  ),
}));

const withBalance = (fields: { tokenCredits: number; packAllotment?: number }): BalanceView => {
  const balance: TBalanceResponse = { autoRefillEnabled: false, ...fields };
  return {
    enabled: true,
    state: { status: 'success', summary: summarizeBalance(balance, { startBalance: 200_000 }) },
    balance,
  };
};

const renderAccount = (collapsed = true) =>
  render(
    <MemoryRouter>
      <RecoilRoot>
        <AccountSettings collapsed={collapsed} />
      </RecoilRoot>
    </MemoryRouter>,
  );

const ringPercent = () =>
  Number(screen.getByTestId('pack-ring-progress').getAttribute('data-percent'));

const ringInk = () =>
  screen.getByTestId('pack-ring-progress').style.getPropertyValue('--pack-ring-ink');

describe('AccountSettings', () => {
  beforeEach(() => {
    mockBalanceView.mockReturnValue({ enabled: false, state: { status: 'loading' } });
  });

  it('shows the usage bar under the email when the menu opens', async () => {
    renderAccount(false);

    await userEvent.click(screen.getByTestId('nav-user'));

    const email = await screen.findByText('sara@example.com');
    const balance = screen.getByTestId('account-balance');
    expect(balance).toBeVisible();
    expect(email.compareDocumentPosition(balance) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('rings the avatar with what is left of the pack and says it in words', () => {
    mockBalanceView.mockReturnValue(
      withBalance({ tokenCredits: 1_000_000, packAllotment: 4_000_000 }),
    );
    renderAccount();
    expect(screen.getByTestId('pack-ring')).toBeInTheDocument();
    expect(ringPercent()).toBe(25);
    expect(screen.getByTestId('pack-ring-progress')).toHaveClass('pack-ring-arc');
    expect(ringInk()).toBe('var(--text-secondary)');
    const button = screen.getByTestId('nav-user');
    expect(button).toHaveAccessibleName('Account Settings');
    expect(button).toHaveAccessibleDescription('25% of your credit left');
  });

  it('turns the ring amber when the pack is nearly spent and red once it is empty', () => {
    mockBalanceView.mockReturnValue(
      withBalance({ tokenCredits: 100_000, packAllotment: 4_000_000 }),
    );
    const { unmount } = renderAccount();
    expect(ringInk()).toBe('var(--status-warning)');
    unmount();

    mockBalanceView.mockReturnValue(withBalance({ tokenCredits: 0, packAllotment: 4_000_000 }));
    renderAccount();
    expect(ringPercent()).toBe(0);
    expect(screen.getByTestId('pack-ring-progress')).toHaveAttribute('data-tone', 'danger');
    expect(ringInk()).toBe('var(--status-error)');
    expect(screen.getByTestId('nav-user')).toHaveAccessibleDescription('0% of your credit left');
  });

  it('fills the ring when credit carried over is more than the pack', () => {
    mockBalanceView.mockReturnValue(
      withBalance({ tokenCredits: 9_000_000, packAllotment: 4_000_000 }),
    );
    renderAccount(false);
    expect(ringPercent()).toBe(100);
    expect(screen.getByTestId('pack-ring-progress').style.getPropertyValue('--pack-ring-tip')).toBe(
      '359.2deg',
    );
  });

  it('rings the avatar for the sign-up gift too, measured against the gift', () => {
    mockBalanceView.mockReturnValue(withBalance({ tokenCredits: 150_000 }));
    renderAccount();
    expect(screen.getByTestId('pack-ring')).toBeInTheDocument();
    expect(ringPercent()).toBe(75);
    expect(screen.getByTestId('nav-user')).toHaveAccessibleDescription('75% of your credit left');
  });

  it.each([
    ['a loading balance', { enabled: true, state: { status: 'loading' } } as BalanceView],
    ['a failed balance', { enabled: true, state: { status: 'error' } } as BalanceView],
    ['balance off', { enabled: false, state: { status: 'loading' } } as BalanceView],
  ])('draws no ring for %s', (_case, view) => {
    mockBalanceView.mockReturnValue(view);
    renderAccount();
    expect(screen.queryByTestId('pack-ring')).not.toBeInTheDocument();
    expect(screen.getByTestId('nav-user')).not.toHaveAttribute('aria-describedby');
  });

  it('offers "Install app" once the browser allows installing, and opens its dialog', async () => {
    listenForInstallPrompt(window);
    resetInstallState();
    renderAccount(false);
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
