import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import Balance from '../index';

let mockSummary: Record<string, unknown>;
let mockStartupConfig: Record<string, unknown>;

jest.mock('~/hooks/useLocalize', () => ({
  __esModule: true,
  default: () => (key: string) => key,
}));
jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: mockStartupConfig }),
}));
jest.mock('~/hooks/useBalanceSummary', () => ({
  __esModule: true,
  default: () => mockSummary,
}));
jest.mock('../Summary', () => ({
  __esModule: true,
  default: () => <div data-testid="balance-summary" />,
}));

const summary = (showPrices: boolean) => ({
  enabled: true,
  currency: { code: 'IRT', rate: 270_000 },
  state: { status: 'success', summary: { showPrices } },
});

const renderBalance = () =>
  render(
    <MemoryRouter>
      <Balance />
    </MemoryRouter>,
  );

describe('Balance', () => {
  beforeEach(() => {
    mockStartupConfig = { balance: { packs: [{ id: 'starter', label: 'S', credits: 4e6 }] } };
  });

  it('leads to the packs page instead of listing prices while there is a reason to buy', () => {
    mockSummary = summary(true);
    renderBalance();

    expect(screen.getByRole('link', { name: 'com_ui_balance_buy_pack' })).toHaveAttribute(
      'href',
      '/payment',
    );
    expect(screen.queryByText(/تومان/)).not.toBeInTheDocument();
  });

  it('shows only the reading once a pack is in use', () => {
    mockSummary = summary(false);
    renderBalance();

    expect(screen.getByTestId('balance-summary')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
