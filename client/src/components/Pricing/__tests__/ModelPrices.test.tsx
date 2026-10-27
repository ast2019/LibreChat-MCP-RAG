import { render, screen, within } from '@testing-library/react';
import type { TModelSpec } from 'librechat-data-provider';
import ModelPrices from '../ModelPrices';

let mockSpecs: TModelSpec[] | undefined;
let mockTokenQuery: { data?: unknown; isLoading: boolean; isError: boolean };

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: { modelSpecs: { list: mockSpecs } } }),
  useTokenConfigQuery: () => mockTokenQuery,
}));

jest.mock('~/hooks/useBalanceSummary', () => ({
  useBalanceDisplay: () => ({ display: 'currency', currency: { code: 'IRT', rate: 100000 } }),
}));

const spec = (name: string, endpoint: string, model: string, group?: string): TModelSpec => ({
  name,
  label: name,
  group,
  preset: { endpoint, model },
});

describe('ModelPrices', () => {
  beforeEach(() => {
    mockSpecs = [
      spec('Sonnet', 'OpenRouter', '~anthropic/claude-sonnet-latest', 'Claude'),
      spec('Local', 'Local', 'local-model', 'لوکال'),
      spec('Mystery', 'OpenRouter', 'not-listed', 'Claude'),
      { ...spec('Hidden', 'OpenRouter', 'x'), showInMenu: false },
    ];
    mockTokenQuery = {
      isLoading: false,
      isError: false,
      data: {
        OpenRouter: { '~anthropic/claude-sonnet-latest': { prompt: 3, completion: 15 } },
        Local: { 'local-model': { prompt: 0, completion: 0 } },
      },
    };
  });

  it('lists each offered spec by group with Toman prices, free and unknown', () => {
    render(<ModelPrices />);
    const table = screen.getByRole('table');
    expect(within(table).getByText('Claude')).toBeInTheDocument();
    expect(within(table).queryByText('Hidden')).not.toBeInTheDocument();

    const sonnet = screen.getByRole('row', { name: /Sonnet/ });
    /** $3 × 100,000 Toman per 1M input tokens, in Persian digits */
    expect(sonnet).toHaveTextContent('۳۰۰٬۰۰۰ تومان');
    expect(sonnet).toHaveTextContent('۱٬۵۰۰٬۰۰۰ تومان');
    /** ($3×3 + $15)/4 = $6 per 1M → 1300 tokens = $0.0078 → 780 Toman */
    expect(sonnet).toHaveTextContent('۷۸۰ تومان');

    const local = screen.getByRole('row', { name: /Local/ });
    expect(within(local).getAllByText('Free').length).toBeGreaterThanOrEqual(3);

    const mystery = screen.getByRole('row', { name: /Mystery/ });
    expect(within(mystery).getAllByText('Unknown')).toHaveLength(3);
  });

  it('shows loading and failure states', () => {
    mockTokenQuery = { isLoading: true, isError: false };
    const { unmount } = render(<ModelPrices />);
    expect(screen.getByTestId('model-prices-loading')).toBeInTheDocument();
    unmount();

    mockTokenQuery = { isLoading: false, isError: true };
    render(<ModelPrices />);
    expect(screen.getByRole('alert')).toHaveTextContent('Model prices could not be loaded.');
  });

  it('renders nothing without model specs', () => {
    mockSpecs = undefined;
    const { container } = render(<ModelPrices />);
    expect(container).toBeEmptyDOMElement();
  });
});
