import userEvent from '@testing-library/user-event';
import { render, screen, within } from '@testing-library/react';
import AdminPayments from '../AdminPayments';

const mockVerify = jest.fn();
const mockReconcile = jest.fn();
const mockToast = jest.fn();
let mockOrders: Record<string, unknown>;
let mockSummary: Record<string, unknown>;
let lastParams: Record<string, unknown> = {};

/** Renders keys, not copy: these assertions name the localization key each string uses. */
jest.mock('~/hooks/useLocalize', () => ({
  __esModule: true,
  default: () => (key: string) => key,
}));

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockToast }),
}));

jest.mock('~/data-provider', () => ({
  useAdminPaymentsQuery: (params: Record<string, unknown>) => {
    lastParams = params;
    return mockOrders;
  },
  useAdminPaymentsSummaryQuery: () => mockSummary,
  useAdminPaymentVerifyMutation: () => ({ mutate: mockVerify, isLoading: false }),
  useAdminPaymentsReconcileMutation: () => ({ mutate: mockReconcile, isLoading: false }),
}));

const order = (overrides: Record<string, unknown>) => ({
  id: 'o1',
  packId: 'starter',
  packLabel: 'Starter',
  credits: 2_000_000,
  amountRial: 5_390_000,
  gateway: 'zarinpal',
  status: 'paid',
  credited: true,
  referenceId: '201',
  cardPan: '502229******5995',
  createdAt: '2025-01-01T00:00:00.000Z',
  paidAt: '2025-01-01T00:01:00.000Z',
  user: { id: 'u1', email: 'sara@example.com', name: 'Sara' },
  ...overrides,
});

describe('AdminPayments', () => {
  beforeEach(() => {
    mockVerify.mockReset();
    mockReconcile.mockReset();
    mockSummary = {
      data: {
        todaySince: '2025-01-01T00:00:00.000Z',
        monthSince: '2025-01-01T00:00:00.000Z',
        today: { count: 1, amountRial: 5_390_000, credits: 2_000_000 },
        month: { count: 3, amountRial: 16_170_000, credits: 6_000_000 },
        pending: 1,
      },
    };
    mockOrders = {
      isLoading: false,
      data: {
        total: 2,
        limit: 25,
        offset: 0,
        orders: [
          order({}),
          order({
            id: 'o2',
            status: 'pending',
            credited: false,
            referenceId: undefined,
            cardPan: undefined,
          }),
        ],
      },
    };
  });

  it('shows today and month totals in tomans', () => {
    render(<AdminPayments />);
    const summary = screen.getByTestId('admin-payments-summary');
    expect(summary).toHaveTextContent('۵۳۹٬۰۰۰ تومان');
    expect(summary).toHaveTextContent('۱٬۶۱۷٬۰۰۰ تومان');
  });

  it('lists orders with user, amount, status and reference, and re-checks only open ones', async () => {
    render(<AdminPayments />);
    const [paidRow, pendingRow] = screen.getAllByTestId('admin-payment-row');
    expect(paidRow).toHaveTextContent('sara@example.com');
    expect(paidRow).toHaveTextContent('201');
    expect(paidRow).toHaveTextContent('com_admin_payments_status_paid');
    expect(within(paidRow).queryByRole('button')).not.toBeInTheDocument();

    await userEvent.click(
      within(pendingRow).getByRole('button', { name: 'com_admin_payments_verify' }),
    );
    expect(mockVerify).toHaveBeenCalledWith('o2', expect.any(Object));
  });

  it('filters by status and gateway', async () => {
    render(<AdminPayments />);
    await userEvent.click(screen.getByRole('radio', { name: 'com_admin_payments_status_pending' }));
    expect(lastParams).toMatchObject({ status: 'pending', offset: 0 });
    await userEvent.click(screen.getByRole('radio', { name: 'com_ui_payment_gateway_idpay' }));
    expect(lastParams).toMatchObject({ status: 'pending', gateway: 'idpay' });
  });

  it('reconciles all pending orders and reports the result', async () => {
    mockReconcile.mockImplementation((_v, handlers) =>
      handlers.onSuccess({ checked: 2, paid: 1, expired: 1, credited: 0, failed: 0 }),
    );
    render(<AdminPayments />);
    await userEvent.click(screen.getByRole('button', { name: 'com_admin_payments_reconcile' }));
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ status: 'success' }));
  });

  it('shows empty and error states', () => {
    mockOrders = { isLoading: false, data: { total: 0, limit: 25, offset: 0, orders: [] } };
    const { rerender } = render(<AdminPayments />);
    expect(screen.getByText('com_admin_payments_empty')).toBeInTheDocument();
    mockOrders = { isLoading: false, isError: true, refetch: jest.fn() };
    rerender(<AdminPayments />);
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent('com_admin_payments_error');
  });
});
