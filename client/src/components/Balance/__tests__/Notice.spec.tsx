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

const viewFor = (
  tokenCredits: number,
  extra: Partial<{
    packId: string;
    packLabel: string;
    packAllotment: number;
    packGrantedAt: string;
  }> = {},
): BalanceView => ({
  enabled: true,
  state: {
    status: 'success',
    summary: summarizeBalance(
      { tokenCredits, autoRefillEnabled: false, packAllotment: 1_000_000, ...extra },
      { display: 'percent' },
    ),
  },
});

/** The same pack granted again later: the same pack id, a new grant. */
const GRANTED_AT = '2026-11-01T10:00:00.000Z';
const REGRANTED_AT = '2026-11-05T10:00:00.000Z';

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

  it('warns again for a new pack, even though the tone is the same', async () => {
    mockView = viewFor(100_000, {
      packId: 'starter',
      packLabel: 'Starter',
      packGrantedAt: GRANTED_AT,
    });
    const { rerender } = render(<Notice />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('balance-notice')).not.toBeInTheDocument();

    /** The same 90% warning, but measured against the next pack. */
    mockView = viewFor(100_000, {
      packId: 'pro',
      packLabel: 'Pro',
      packGrantedAt: REGRANTED_AT,
    });
    rerender(<Notice />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('warns again when the same pack is granted again', async () => {
    mockView = viewFor(100_000, {
      packId: 'starter',
      packLabel: 'Starter',
      packGrantedAt: GRANTED_AT,
    });
    const { rerender } = render(<Notice />);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('balance-notice')).not.toBeInTheDocument();

    /** The same pack id, granted again: a new grant, so a new warning. */
    mockView = viewFor(100_000, {
      packId: 'starter',
      packLabel: 'Starter',
      packGrantedAt: REGRANTED_AT,
    });
    rerender(<Notice />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('stays dismissed while the share spent grows within the same grant', async () => {
    mockView = viewFor(100_000, {
      packId: 'starter',
      packLabel: 'Starter',
      packGrantedAt: GRANTED_AT,
    });
    const { rerender } = render(<Notice />);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('balance-notice')).not.toBeInTheDocument();

    /** The share is floored, so 90% and 95% are both "90% used" — one warning, not two. */
    mockView = viewFor(50_000, {
      packId: 'starter',
      packLabel: 'Starter',
      packGrantedAt: GRANTED_AT,
    });
    rerender(<Notice />);
    expect(screen.queryByTestId('balance-notice')).not.toBeInTheDocument();
  });

  it('warns again after a new pack is bought and spent down to empty', async () => {
    mockView = viewFor(0, {
      packId: 'starter',
      packLabel: 'Starter',
      packGrantedAt: GRANTED_AT,
    });
    const { rerender } = render(<Notice />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('balance-notice')).not.toBeInTheDocument();

    /** A fresh pack, then spent down to nothing: the empty warning is a different warning. */
    mockView = viewFor(0, {
      packId: 'pro',
      packLabel: 'Pro',
      packGrantedAt: REGRANTED_AT,
    });
    rerender(<Notice />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
