import { RecoilRoot } from 'recoil';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
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

let mockPacksAvailable = false;
jest.mock('~/hooks/useBalancePacks', () => ({
  __esModule: true,
  default: () => ({ available: mockPacksAvailable, query: {} }),
}));

jest.mock('~/components/Balance/Packs', () => ({
  __esModule: true,
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="packs-dialog" /> : null),
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

  it('offers buying a pack only when packs exist, and opens the pack dialog', async () => {
    const view = () =>
      render(
        <MemoryRouter>
          <RecoilRoot>
            <AccountSettings />
          </RecoilRoot>
        </MemoryRouter>,
      );
    mockPacksAvailable = false;
    const { unmount } = view();
    await userEvent.click(screen.getByTestId('nav-user'));
    await screen.findByText('sara@example.com');
    expect(screen.queryByTestId('nav-buy-pack')).not.toBeInTheDocument();
    unmount();

    mockPacksAvailable = true;
    view();
    await userEvent.click(screen.getByTestId('nav-user'));
    await userEvent.click(await screen.findByTestId('nav-buy-pack'));
    expect(screen.getByTestId('packs-dialog')).toBeInTheDocument();
  });
});
