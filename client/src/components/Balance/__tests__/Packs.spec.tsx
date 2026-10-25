import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import Packs from '../Packs';

const mockRefetch = jest.fn();
let mockQuery: Record<string, unknown>;

jest.mock('~/hooks/useBalancePacks', () => ({
  __esModule: true,
  default: () => ({ available: true, query: mockQuery }),
}));

const packs = [
  { id: 'starter', label: 'Starter', description: 'For a week', priceRial: 6_470_000 },
  { id: 'pro', label: 'Pro', priceRial: null },
];

const renderPacks = () => render(<Packs open={true} onOpenChange={jest.fn()} />);

describe('balance Packs dialog', () => {
  beforeEach(() => {
    mockRefetch.mockReset();
    mockQuery = {
      data: { enabled: true, packs },
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
    };
  });

  it('lists packs with rial prices in Persian digits and no dollar figures', () => {
    renderPacks();
    const dialog = screen.getByRole('dialog', { name: 'Buy a pack' });
    const cards = screen.getAllByTestId('balance-pack');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('Starter');
    expect(cards[0]).toHaveTextContent('For a week');
    expect(cards[0]).toHaveTextContent('۶٬۴۷۰٬۰۰۰ rials');
    expect(cards[1]).toHaveTextContent('Price unavailable');
    expect(dialog).not.toHaveTextContent('$');
    expect(screen.getByText('To buy a pack, contact support.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Buy/ })).not.toBeInTheDocument();
  });

  it('links to the purchase page in a new tab when one is configured', () => {
    mockQuery = {
      ...mockQuery,
      data: { enabled: true, packs, purchaseUrl: 'https://shop.example.com' },
    };
    renderPacks();
    const link = screen.getByRole('link', { name: 'Buy' });
    expect(link).toHaveAttribute('href', 'https://shop.example.com');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.queryByText('To buy a pack, contact support.')).not.toBeInTheDocument();
  });

  it('shows a loading state', () => {
    mockQuery = { ...mockQuery, data: undefined, isLoading: true };
    renderPacks();
    expect(screen.getByRole('status', { name: 'Loading...' })).toBeInTheDocument();
  });

  it('shows an empty state', () => {
    mockQuery = { ...mockQuery, data: { enabled: true, packs: [] } };
    renderPacks();
    expect(screen.getByText('No packs are available right now.')).toBeInTheDocument();
  });

  it('shows an error with a retry', async () => {
    mockQuery = { ...mockQuery, data: undefined, isError: true };
    renderPacks();
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load the packs.");
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mockRefetch).toHaveBeenCalled();
  });
});
