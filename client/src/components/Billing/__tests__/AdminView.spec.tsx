import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import AdminView from '../AdminView';

let mockRole = 'ADMIN';
const mockMutate = jest.fn();
let mockSummary: Record<string, unknown>;
let mockUsers: Record<string, unknown>;
let mockCurrency: { code: string; rate: number; priceStep?: number } | undefined;

jest.mock('~/hooks', () => ({
  useLocalize: jest.requireActual('~/hooks/useLocalize').default,
  useAuthContext: () => ({ user: { id: 'admin', role: mockRole } }),
  useDocumentTitle: jest.fn(),
}));

jest.mock('~/components/Chat/Menus/OpenSidebar', () => ({ __esModule: true, default: () => null }));

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: jest.fn() }),
}));

jest.mock('~/data-provider', () => ({
  useAdminBillingSummaryQuery: () => mockSummary,
  useAdminBillingUsersQuery: () => mockUsers,
  useAdminBillingPacksQuery: () => ({
    data: { enabled: true, packs: [{ id: 'starter', label: 'Starter', credits: 2_000_000 }] },
  }),
  useAdminBillingGrantMutation: () => ({ mutate: mockMutate, isLoading: false }),
  useGetStartupConfig: () => ({
    data: {
      interface: { currency: mockCurrency },
      currencyRate: { source: 'tgju', updatedAt: '2026-10-25T16:29:59.000Z' },
    },
  }),
}));

const summaryData = {
  days: 30,
  since: '2026-09-25T00:00:00.000Z',
  priceMultiplier: 1.3,
  totalUsers: 2,
  activeUsers: 1,
  creditsGranted: 9_000_000,
  creditsGrantedInWindow: 2_000_000,
  packGrantsInWindow: 1,
  creditsSpentInWindow: 1_300_000,
  creditsOutstanding: 7_000_000,
  estimatedProviderCredits: 1_000_000,
  topModels: [{ model: 'google/gemini-3.8-flash', credits: 1_300_000 }],
};

const usersData = {
  total: 1,
  limit: 25,
  offset: 0,
  users: [
    {
      id: 'u1',
      name: 'Sara',
      username: 'sara',
      email: 'sara@example.com',
      role: 'USER',
      balance: { tokenCredits: 500_000, packLabel: 'Starter', packAllotment: 2_000_000 },
      usedPercent: 75,
    },
  ],
};

const renderView = () =>
  render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/admin" element={<AdminView />} />
        <Route path="/c/new" element={<div data-testid="chat-page" />} />
      </Routes>
    </MemoryRouter>,
  );

describe('AdminView', () => {
  beforeEach(() => {
    mockRole = 'ADMIN';
    mockMutate.mockReset();
    mockSummary = { data: summaryData, isError: false };
    mockUsers = { data: usersData, isLoading: false, isError: false };
    mockCurrency = undefined;
  });

  it('shows the money summary and the user list', () => {
    renderView();
    expect(screen.getByRole('heading', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.getByText('$2.00')).toBeInTheDocument();
    expect(screen.getByText('$0.30')).toBeInTheDocument();
    expect(screen.getByText('sara@example.com')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-rate')).not.toBeInTheDocument();
  });

  it('shows every amount in Toman too, with the rate and its source', async () => {
    mockCurrency = { code: 'IRT', rate: 269_500, priceStep: 1000 };
    renderView();
    expect(screen.getByTestId('admin-rate')).toHaveTextContent('۲۶۹٬۵۰۰ تومان');
    expect(screen.getByTestId('admin-rate')).toHaveTextContent('tgju');
    /** granted $2.00 */
    expect(screen.getByText('۵۳۹٬۰۰۰ تومان')).toBeInTheDocument();
    /** Sara's balance $0.50 */
    expect(screen.getByText('۱۳۴٬۷۵۰ تومان')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Add credit' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('۵۳۹٬۰۰۰ تومان');
  });

  it('shows loading and error states', () => {
    mockSummary = { data: undefined, isError: true };
    mockUsers = { data: undefined, isLoading: true, isError: false };
    renderView();
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load admin data");
  });

  it('sends non-admins back to the chat', () => {
    mockRole = 'USER';
    renderView();
    expect(screen.getByTestId('chat-page')).toBeInTheDocument();
  });

  it('grants a pack from the dialog', async () => {
    renderView();
    await userEvent.click(screen.getByRole('button', { name: 'Add credit' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(mockMutate).toHaveBeenCalledWith(
        { userId: 'u1', packId: 'starter' },
        expect.any(Object),
      ),
    );
  });

  it('grants a custom dollar amount as credits', async () => {
    renderView();
    await userEvent.click(screen.getByRole('button', { name: 'Add credit' }));
    await userEvent.click(await screen.findByRole('radio', { name: 'Custom amount' }));
    await userEvent.type(screen.getByLabelText('Amount in US dollars of usage'), '2.5');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(mockMutate).toHaveBeenCalledWith(
      { userId: 'u1', credits: 2_500_000 },
      expect.any(Object),
    );
  });
});
