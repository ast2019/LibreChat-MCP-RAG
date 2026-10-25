import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import AdminView from '../AdminView';

let mockRole = 'ADMIN';
const mockMutate = jest.fn();
let mockSummary: Record<string, unknown>;
let mockUsers: Record<string, unknown>;
let mockPacks: Record<string, unknown>;

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
  useAdminBillingPacksQuery: () => mockPacks,
  useAdminBillingGrantMutation: () => ({ mutate: mockMutate, isLoading: false }),
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
  rialPerUsd: null,
};

const packsData = {
  enabled: true,
  packs: [{ id: 'starter', label: 'Starter', credits: 2_000_000, priceUsd: 2, priceRial: null }],
  rial: null,
};

const RIAL = {
  enabled: true,
  marketRate: 2_695_000,
  feePercent: 20,
  rate: 3_234_000,
  source: 'tgju',
  updatedAt: '2026-10-25T15:57:58.000Z',
  stale: false,
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
    mockPacks = { data: packsData };
  });

  it('shows the money summary and the user list', () => {
    renderView();
    expect(screen.getByRole('heading', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.getByText('$2.00')).toBeInTheDocument();
    expect(screen.getByText('$0.30')).toBeInTheDocument();
    expect(screen.getByText('sara@example.com')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('shows no rial figures or rate while rial pricing is off', () => {
    renderView();
    expect(screen.queryByText(/rials/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('admin-rial-rate')).not.toBeInTheDocument();
  });

  it('shows every money figure in rial too, with the rate used', async () => {
    mockSummary = { data: { ...summaryData, rialPerUsd: 3_234_000 }, isError: false };
    mockPacks = {
      data: {
        ...packsData,
        packs: [{ ...packsData.packs[0], priceRial: 6_470_000 }],
        rial: { ...RIAL, stale: true },
      },
    };
    renderView();
    /** Granted $2.00 at 3,234,000 rial per USD */
    expect(screen.getByText('۶٬۴۶۸٬۰۰۰ rials')).toBeInTheDocument();
    /** Sara's $0.50 balance */
    expect(screen.getByText('۱٬۶۱۷٬۰۰۰ rials')).toBeInTheDocument();
    const rate = screen.getByTestId('admin-rial-rate');
    expect(rate).toHaveTextContent('Dollar rate: ۲٬۶۹۵٬۰۰۰ rials + ۲۰% fee · source tgju');
    expect(rate).toHaveTextContent('Stale');

    await userEvent.click(screen.getByRole('button', { name: 'Add credit' }));
    const option = await screen.findByRole('radio', { name: /Starter/ });
    expect(option.closest('label')).toHaveTextContent('$2.00');
    expect(option.closest('label')).toHaveTextContent('۶٬۴۷۰٬۰۰۰ rials');
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
