import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, within, waitFor } from '@testing-library/react';
import AdminView from '../AdminView';

let mockRole = 'ADMIN';
const mockMutate = jest.fn();
const mockRoleMutate = jest.fn();
const mockModelAccessMutate = jest.fn();
let mockUserRole: Record<string, unknown>;
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
  useGetRole: () => mockUserRole,
  useUpdateRolePermissionsMutation: () => ({ mutate: mockRoleMutate, isLoading: false }),
  useAdminUserModelAccessMutation: () => ({ mutate: mockModelAccessMutate, isLoading: false }),
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

const renderView = (path = '/admin') =>
  render(
    <MemoryRouter initialEntries={[path]}>
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
    mockRoleMutate.mockReset();
    localStorage.removeItem('adminAdvancedMode');
    mockUserRole = {
      isLoading: false,
      isError: false,
      data: {
        name: 'USER',
        permissions: {
          WEB_SEARCH: { USE: true },
          PROMPTS: { USE: false, CREATE: false },
        },
      },
    };
  });

  it('opens on the overview with the money summary, and lists users on their tab', async () => {
    renderView();
    expect(screen.getByRole('heading', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Overview', selected: true })).toBeInTheDocument();
    expect(screen.getByText('$2.00')).toBeInTheDocument();
    expect(screen.getByText('$0.30')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-rate')).not.toBeInTheDocument();
    expect(screen.queryByText('sara@example.com')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Users & credit' }));
    expect(await screen.findByText('sara@example.com')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('shows every amount in Toman too, with the rate and its source', async () => {
    mockCurrency = { code: 'IRT', rate: 269_500, priceStep: 1000 };
    const { unmount } = renderView();
    expect(screen.getByTestId('admin-rate')).toHaveTextContent('۲۶۹٬۵۰۰ تومان');
    expect(screen.getByTestId('admin-rate')).toHaveTextContent('tgju');
    /** granted $2.00 */
    expect(screen.getByText('۵۳۹٬۰۰۰ تومان')).toBeInTheDocument();
    unmount();

    renderView('/admin?tab=users');
    /** Sara's balance $0.50 */
    expect(screen.getByText('۱۳۴٬۷۵۰ تومان')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add credit' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('۵۳۹٬۰۰۰ تومان');
  });

  it('switches what users can use on the access tab', async () => {
    renderView('/admin?tab=access');
    const webSearch = screen.getByRole('switch', { name: 'Web search: Use' });
    expect(webSearch).toBeChecked();
    const prompts = screen.getByRole('switch', { name: 'Prompt library: Use' });
    expect(prompts).not.toBeChecked();
    /** Creating needs using first */
    expect(screen.getByRole('switch', { name: 'Prompt library: Create' })).toBeDisabled();

    await userEvent.click(prompts);
    expect(mockRoleMutate).toHaveBeenCalledWith(
      { roleName: 'USER', key: 'prompts', updates: { USE: true } },
      expect.any(Object),
    );
    await userEvent.click(webSearch);
    expect(mockRoleMutate).toHaveBeenLastCalledWith(
      { roleName: 'USER', key: 'web-search', updates: { USE: false } },
      expect.any(Object),
    );
  });

  it('shows local and private AI as granted until the role withholds them, and switches them', async () => {
    renderView('/admin?tab=access');
    const local = within(screen.getByTestId('access-local-models')).getByRole('switch');
    const privateModels = within(screen.getByTestId('access-private-models')).getByRole('switch');
    /** The role does not store either type yet; the server grants both then */
    expect(local).toBeChecked();
    expect(privateModels).toBeChecked();

    await userEvent.click(local);
    expect(mockRoleMutate).toHaveBeenCalledWith(
      { roleName: 'USER', key: 'local-models', updates: { USE: false } },
      expect.any(Object),
    );
  });

  it('reflects a withheld private AI permission', () => {
    mockUserRole = {
      isLoading: false,
      isError: false,
      data: { name: 'USER', permissions: { PRIVATE_MODELS: { USE: false } } },
    };
    renderView('/admin?tab=access');
    expect(
      within(screen.getByTestId('access-private-models')).getByRole('switch'),
    ).not.toBeChecked();
  });

  it('turns the admin advanced mode on and keeps it in this browser', async () => {
    renderView('/admin?tab=advanced');
    const toggle = screen.getByRole('switch', { name: 'Advanced mode for me' });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    expect(toggle).toBeChecked();
    expect(localStorage.getItem('adminAdvancedMode')).toBe('true');
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
    renderView('/admin?tab=users');
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
    renderView('/admin?tab=users');
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
