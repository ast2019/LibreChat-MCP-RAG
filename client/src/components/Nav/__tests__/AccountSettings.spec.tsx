import { RecoilRoot } from 'recoil';
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

jest.mock('~/components/Balance', () => ({
  __esModule: true,
  default: ({ className }: { className?: string }) => (
    <div data-testid="account-balance" className={className} />
  ),
}));

describe('AccountSettings', () => {
  it('shows the usage bar under the email when the menu opens', async () => {
    render(
      <RecoilRoot>
        <AccountSettings />
      </RecoilRoot>,
    );

    await userEvent.click(screen.getByTestId('nav-user'));

    const email = await screen.findByText('sara@example.com');
    const balance = screen.getByTestId('account-balance');
    expect(balance).toBeVisible();
    expect(email.compareDocumentPosition(balance) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
