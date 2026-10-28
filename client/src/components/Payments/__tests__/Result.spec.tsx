import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import Result from '../Result';

const mockInvalidate = jest.fn();
let mockOrder: Record<string, unknown>;

/** Renders keys, not copy: these assertions name the localization key each string uses. */
jest.mock('~/hooks/useLocalize', () => ({
  __esModule: true,
  default: () => (key: string) => key,
}));

jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}));

jest.mock('~/data-provider', () => ({
  usePaymentOrderQuery: () => mockOrder,
  useGetStartupConfig: () => ({
    data: { balance: { display: 'pack' }, interface: { currency: { code: 'IRT', rate: 269_500 } } },
  }),
}));

const paid = {
  id: 'o1',
  packId: 'starter',
  packLabel: 'Starter',
  credits: 2_000_000,
  amountRial: 5_390_000,
  gateway: 'zarinpal',
  status: 'paid',
  referenceId: '201',
  credited: true,
  createdAt: '2025-01-01T00:00:00.000Z',
};

const renderAt = (query: string) =>
  render(
    <MemoryRouter initialEntries={[`/payment/result?${query}`]}>
      <Result />
    </MemoryRouter>,
  );

describe('payment Result', () => {
  beforeEach(() => mockInvalidate.mockReset());

  it('shows the receipt and refreshes the balance after a credited payment', () => {
    mockOrder = { data: paid, isLoading: false, isError: false };
    renderAt('status=success&order=o1');
    const result = screen.getByTestId('payment-result');
    expect(result).toHaveAttribute('data-view', 'success');
    expect(result).toHaveAttribute('role', 'status');
    expect(screen.getAllByText('۵۳۹٬۰۰۰ تومان')[0]).toBeInTheDocument();
    expect(screen.getByText('201')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText('com_ui_payment_credit_added')).toBeInTheDocument();
    expect(mockInvalidate).toHaveBeenCalledWith(['balance']);
    expect(screen.queryByRole('link', { name: 'com_ui_payment_retry' })).not.toBeInTheDocument();
  });

  it('says the credit is on its way when the order is paid but not yet credited', () => {
    mockOrder = { data: { ...paid, credited: false }, isLoading: false };
    renderAt('status=pending&order=o1&code=credit_failed');
    expect(screen.getByTestId('payment-result')).toHaveAttribute('data-view', 'crediting');
    expect(screen.getByText('com_ui_payment_crediting')).toBeInTheDocument();
  });

  it('explains a canceled payment and offers a retry for the same pack', () => {
    mockOrder = {
      data: { ...paid, status: 'canceled', errorCode: 'canceled', referenceId: undefined },
      isLoading: false,
    };
    renderAt('status=failed&order=o1&code=canceled');
    expect(screen.getByRole('alert')).toHaveTextContent('com_ui_payment_error_canceled');
    expect(screen.getByRole('link', { name: 'com_ui_payment_retry' })).toHaveAttribute(
      'href',
      '/payment?pack=starter',
    );
  });

  it('keeps a pending order on the waiting message', () => {
    mockOrder = { data: { ...paid, status: 'pending', credited: false }, isLoading: false };
    renderAt('status=pending&order=o1');
    expect(screen.getByText('com_ui_payment_pending_hint')).toBeInTheDocument();
  });

  it("reports an order that is not the user's as not found", () => {
    mockOrder = { data: undefined, isLoading: false, isError: true };
    renderAt('status=success&order=o2');
    expect(screen.getByRole('alert')).toHaveTextContent('com_ui_payment_error_order_not_found');
  });

  it('shows a skeleton while the order loads', () => {
    mockOrder = { isLoading: true };
    renderAt('status=success&order=o1');
    expect(screen.getByLabelText(/loading/i)).toBeInTheDocument();
  });

  it('maps a code without an order', () => {
    mockOrder = { data: undefined, isLoading: false, isError: false };
    renderAt('status=failed&code=invalid_callback');
    expect(screen.getByRole('alert')).toHaveTextContent('com_ui_payment_error_invalid_callback');
  });
});
