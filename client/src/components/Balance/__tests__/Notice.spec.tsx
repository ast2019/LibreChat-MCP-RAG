import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import type { BalanceView } from '~/hooks/useBalanceSummary';
import { summarizeBalance } from '~/utils/balance';
import Notice from '../Notice';

let mockView: BalanceView;
let mockPurchaseUrl: string | undefined;
let mockPayments: { enabled: boolean; gateways: string[] } | undefined;

jest.mock('~/hooks/useBalanceSummary', () => ({
  __esModule: true,
  default: () => mockView,
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({
    data: { balance: { purchaseUrl: mockPurchaseUrl }, payments: mockPayments },
  }),
}));

const viewFor = (tokenCredits: number): BalanceView => ({
  enabled: true,
  state: {
    status: 'success',
    summary: summarizeBalance(
      { tokenCredits, autoRefillEnabled: false, packAllotment: 1_000_000 },
      { display: 'percent' },
    ),
  },
});

describe('balance Notice', () => {
  beforeEach(() => {
    mockPurchaseUrl = 'https://shop.example.com/packs';
    mockPayments = undefined;
  });

  it('links to the in-app purchase page when payments are enabled', () => {
    mockPayments = { enabled: true, gateways: ['zarinpal'] };
    mockView = viewFor(0);
    render(
      <MemoryRouter>
        <Notice />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Buy a pack' });
    expect(link).toHaveAttribute('href', '/payment');
    expect(link).not.toHaveAttribute('target');
  });

  it('renders nothing below 90% used', () => {
    mockView = viewFor(500_000);
    render(<Notice />);
    expect(screen.queryByTestId('balance-notice')).not.toBeInTheDocument();
  });

  it('renders nothing while loading or when metering is off', () => {
    mockView = { enabled: true, state: { status: 'loading' } };
    const { rerender } = render(<Notice />);
    expect(screen.queryByTestId('balance-notice')).not.toBeInTheDocument();
    mockView = { ...viewFor(0), enabled: false };
    rerender(<Notice />);
    expect(screen.queryByTestId('balance-notice')).not.toBeInTheDocument();
  });

  it('warns at 90% with a link to buy a pack', () => {
    mockView = viewFor(100_000);
    render(<Notice />);
    expect(screen.getByRole('status')).toHaveTextContent("You've used 90% of your credit");
    expect(screen.getByRole('link', { name: 'Buy a pack' })).toHaveAttribute(
      'href',
      'https://shop.example.com/packs',
    );
  });

  it('alerts when credits run out and hides the button without a purchase URL', () => {
    mockPurchaseUrl = undefined;
    mockView = viewFor(0);
    render(<Notice />);
    expect(screen.getByRole('alert')).toHaveTextContent("You're out of credit");
    expect(screen.queryByRole('link', { name: 'Buy a pack' })).not.toBeInTheDocument();
  });

  it('stays dismissed for the same warning but returns when credits run out', async () => {
    mockView = viewFor(100_000);
    const { rerender } = render(<Notice />);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('balance-notice')).not.toBeInTheDocument();

    mockView = viewFor(50_000);
    rerender(<Notice />);
    expect(screen.queryByTestId('balance-notice')).not.toBeInTheDocument();

    mockView = viewFor(0);
    rerender(<Notice />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
