import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, within, waitFor } from '@testing-library/react';
import AdminView from '../AdminView';

let mockRole = 'ADMIN';
const mockMutate = jest.fn();
const mockRoleMutate = jest.fn();
const mockModelAccessMutate = jest.fn();
const mockSetRoleMutate = jest.fn();
const mockApiAccessMutate = jest.fn();
const mockMediaAccessMutate = jest.fn();
const mockGiftsMutate = jest.fn();
const mockBulkGrantMutate = jest.fn();
const mockPacksMutate = jest.fn();
const mockBulkAccessMutate = jest.fn();
let mockUsersParams: Record<string, unknown> | undefined;
let mockUserRole: Record<string, unknown>;
let mockSummary: Record<string, unknown>;
let mockUsers: Record<string, unknown>;
let mockCurrency: { code: string; rate: number; priceStep?: number } | undefined;
let mockStatus: Record<string, unknown>;

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
  useAdminBillingUsersQuery: (params: Record<string, unknown>) => {
    mockUsersParams = params;
    return mockUsers;
  },
  useAdminBillingPacksQuery: () => ({
    data: {
      enabled: true,
      packs: [{ id: 'starter', label: 'Starter', credits: 2_000_000 }],
      startBalance: 200_000,
    },
  }),
  useAdminBillingGrantMutation: () => ({ mutate: mockMutate, isLoading: false }),
  useAdminBillingPacksMutation: () => ({ mutate: mockPacksMutate, isLoading: false }),
  useAdminBillingBulkGrantMutation: () => ({ mutate: mockBulkGrantMutate, isLoading: false }),
  useAdminUsersBulkAccessMutation: () => ({ mutate: mockBulkAccessMutate, isLoading: false }),
  useAdminServiceStatusQuery: () => mockStatus,
  useRefreshAdminServiceStatusMutation: () => ({
    mutate: jest.fn(),
    isLoading: false,
    isError: false,
  }),
  useGetRole: () => mockUserRole,
  useUpdateRolePermissionsMutation: () => ({ mutate: mockRoleMutate, isLoading: false }),
  useAdminUserModelAccessMutation: () => ({ mutate: mockModelAccessMutate, isLoading: false }),
  useAdminSetUserRoleMutation: () => ({ mutate: mockSetRoleMutate, isLoading: false }),
  useAdminUserApiAccessMutation: () => ({ mutate: mockApiAccessMutate, isLoading: false }),
  useAdminUserMediaAccessMutation: () => ({ mutate: mockMediaAccessMutate, isLoading: false }),
  useAdminGiftsQuery: () => ({
    data: {
      startBalance: 200_000,
      referral: {
        enabled: true,
        referrerCredits: 500_000,
        inviteeCredits: 200_000,
        maxRewardsPerReferrer: 20,
      },
      changedAt: '2026-10-29T10:00:00.000Z',
    },
    isError: false,
  }),
  useAdminGiftsMutation: () => ({ mutate: mockGiftsMutate, isLoading: false }),
  useAdminCreateUserMutation: () => ({ mutate: jest.fn(), isLoading: false }),
  useGetStartupConfig: () => ({
    data: {
      interface: { currency: mockCurrency },
      currencyRate: { source: 'tgju', updatedAt: '2026-10-25T16:29:59.000Z' },
    },
  }),
}));

/** Opens the first row's «⋯» menu and picks an action. */
async function openRowAction(name: string) {
  await userEvent.click(screen.getAllByTestId('admin-user-actions')[0]);
  await userEvent.click(await screen.findByRole('menuitem', { name }));
}

/** Opens the first user's sheet, where their access is changed. */
async function openDetails() {
  await openRowAction('Details and access');
  return screen.findByTestId('admin-user-drawer');
}

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
    mockStatus = { isLoading: true };
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

    await userEvent.click(screen.getByRole('tab', { name: 'User management' }));
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
    await openRowAction('Add credit');
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

  it('puts each row in one list with its actions behind a menu', async () => {
    renderView('/admin?tab=users');
    const row = screen.getByTestId('admin-user-row');
    expect(row).toHaveTextContent('Sara');
    expect(row).toHaveTextContent('sara@example.com');
    expect(within(row).queryByRole('button', { name: 'Add credit' })).not.toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Actions for Sara' }));
    expect(await screen.findByRole('menuitem', { name: 'Usage' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Make admin' })).toBeInTheDocument();
  });

  it('tells admins about the welcome gift new accounts get', () => {
    renderView('/admin?tab=users');
    expect(screen.getByTestId('admin-gift-note')).toHaveTextContent('$0.20');
  });

  it('turns the API on for one user from their sheet', async () => {
    renderView('/admin?tab=users');
    await openDetails();
    await userEvent.click(screen.getByTestId('api-access-u1'));
    await userEvent.click(await screen.findByRole('option', { name: 'On' }));
    expect(mockApiAccessMutate).toHaveBeenCalledWith(
      { userId: 'u1', apiAccess: true },
      expect.any(Object),
    );
  });

  it('lets one user generate media without a pack', async () => {
    renderView('/admin?tab=users');
    await openDetails();
    await userEvent.click(screen.getByTestId('media-access-u1'));
    await userEvent.click(await screen.findByRole('option', { name: 'On' }));
    expect(mockMediaAccessMutate).toHaveBeenCalledWith(
      { userId: 'u1', mediaAccess: true },
      expect.any(Object),
    );
  });

  it('opens a user sheet from their name, with pack, access and role', async () => {
    renderView('/admin?tab=users');
    await userEvent.click(screen.getByRole('button', { name: 'Sara' }));
    const drawer = await screen.findByTestId('admin-user-drawer');
    expect(drawer).toHaveTextContent('Pack and credit');
    expect(drawer).toHaveTextContent('Starter');
    expect(within(drawer).getByTestId('model-access-local-u1')).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'Make admin' })).toBeInTheDocument();
  });

  it('lists only the access a user has now, without a control in the row', () => {
    mockUsers = {
      data: {
        ...usersData,
        users: [
          {
            ...usersData.users[0],
            mediaAccess: false,
            effective: {
              local: { allowed: true, source: 'role' },
              private: { allowed: true, source: 'role' },
              media: { allowed: false, source: 'user' },
              api: { allowed: false, source: 'role' },
            },
          },
        ],
      },
      isLoading: false,
      isError: false,
    };
    renderView('/admin?tab=users');
    const summary = screen.getByTestId('access-summary-u1');
    /** Only what the user has now; a class that is off is not listed */
    expect(summary).toHaveTextContent('Secure local AI');
    expect(summary).not.toHaveTextContent('Special secure local AI');
    expect(summary).not.toHaveTextContent('Image, video and voice');
    expect(summary).not.toHaveTextContent('API');
    expect(screen.queryByTestId('media-access-u1')).not.toBeInTheDocument();
  });

  it('gives admins the special secure local chip', () => {
    mockUsers = {
      data: { ...usersData, users: [{ ...usersData.users[0], role: 'ADMIN' }] },
      isLoading: false,
      isError: false,
    };
    renderView('/admin?tab=users');
    expect(screen.getByTestId('access-summary-u1')).toHaveTextContent('Special secure local AI');
  });

  it('changes one access for the selected users', async () => {
    renderView('/admin?tab=users');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Sara' }));
    expect(screen.getByTestId('admin-bulk-bar')).toHaveTextContent('1 users selected');
    await userEvent.click(screen.getByRole('button', { name: 'Change access' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'API' }));
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Off' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(mockBulkAccessMutate).toHaveBeenCalledWith(
      { userIds: ['u1'], field: 'api', value: false },
      expect.any(Object),
    );
  });

  it('adds a pack to every selected user', async () => {
    renderView('/admin?tab=users');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all on this page' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add a pack or credit' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add' }));
    expect(mockBulkGrantMutate).toHaveBeenCalledWith(
      { userIds: ['u1'], packId: 'starter' },
      expect.any(Object),
    );
  });

  it('reads the filters and the page from the address', () => {
    renderView('/admin?tab=users&role=ADMIN&pack=pack:starter&sort=name&page=2&q=sara');
    expect(mockUsersParams).toEqual(
      expect.objectContaining({
        search: 'sara',
        role: 'ADMIN',
        pack: 'starter',
        sort: 'name',
        offset: 25,
      }),
    );
    expect(screen.getByRole('searchbox')).toHaveValue('sara');
  });

  it('edits a pack, says what it includes, and saves the whole list', async () => {
    renderView('/admin?tab=packs');
    const pack = screen.getByTestId('admin-pack');
    const save = screen.getByTestId('admin-packs-save');
    /** Nothing changed yet */
    expect(save).toBeDisabled();

    const name = within(pack).getByLabelText('Name users see');
    await userEvent.clear(name);
    await userEvent.type(name, 'Starter plus');
    await userEvent.click(within(pack).getByTestId('pack-grant-media-starter'));
    await userEvent.click(await screen.findByRole('option', { name: 'Included' }));
    /** A saved pack keeps its id */
    expect(within(pack).getByLabelText('ID')).toHaveAttribute('readonly');

    await userEvent.click(save);
    expect(mockPacksMutate).toHaveBeenCalledWith(
      {
        packs: [
          { id: 'starter', label: 'Starter plus', credits: 2_000_000, grants: { media: true } },
        ],
      },
      expect.any(Object),
    );
  });

  it('adds a pack and blocks saving until it has a name and a price', async () => {
    renderView('/admin?tab=packs');
    await userEvent.click(screen.getByRole('button', { name: 'Add a pack' }));
    const added = screen.getAllByTestId('admin-pack')[1];
    expect(within(added).getByLabelText('ID')).toHaveValue('pack-2');
    expect(screen.getByTestId('admin-packs-save')).toBeDisabled();
    expect(screen.getByText('Fix the marked fields to save.')).toBeInTheDocument();

    await userEvent.type(within(added).getByLabelText('Name users see'), 'Team');
    await userEvent.type(within(added).getByLabelText('Usage it includes, in dollars'), '50');
    await userEvent.click(screen.getByTestId('admin-packs-save'));
    expect(mockPacksMutate).toHaveBeenCalledWith(
      {
        packs: [
          { id: 'starter', label: 'Starter', credits: 2_000_000 },
          { id: 'pack-2', label: 'Team', credits: 50_000_000 },
        ],
      },
      expect.any(Object),
    );
  });

  it('warns that users keep their credit when a pack is removed', async () => {
    renderView('/admin?tab=packs');
    await userEvent.click(screen.getByRole('button', { name: 'Remove Starter' }));
    expect(screen.getByRole('status')).toHaveTextContent('users who have it keep their credit');
    await userEvent.click(screen.getByTestId('admin-packs-save'));
    expect(mockPacksMutate).toHaveBeenCalledWith({ packs: [] }, expect.any(Object));
  });

  it('lets the admin set the invite reward, applied from now on', async () => {
    renderView('/admin?tab=gifts');
    const inviter = screen.getByLabelText('Reward for the inviter');
    expect(inviter).toHaveValue('0.5');
    await userEvent.clear(inviter);
    await userEvent.type(inviter, '0.75');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(mockGiftsMutate).toHaveBeenCalledWith(
      {
        startBalance: 200_000,
        referral: {
          enabled: true,
          referrerCredits: 750_000,
          inviteeCredits: 200_000,
          maxRewardsPerReferrer: 20,
        },
      },
      expect.any(Object),
    );
  });

  it('makes a user an admin after confirming', async () => {
    renderView('/admin?tab=users');
    await openRowAction('Make admin');
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Make admin' }));
    expect(mockSetRoleMutate).toHaveBeenCalledWith(
      { userId: 'u1', admin: true },
      expect.any(Object),
    );
  });

  it('grants a pack from the dialog', async () => {
    renderView('/admin?tab=users');
    await openRowAction('Add credit');
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
    await openRowAction('Add credit');
    await userEvent.click(await screen.findByRole('radio', { name: 'Custom amount' }));
    await userEvent.type(screen.getByLabelText('Amount in US dollars of usage'), '2.5');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(mockMutate).toHaveBeenCalledWith(
      { userId: 'u1', credits: 2_500_000 },
      expect.any(Object),
    );
  });

  it('warns on the overview when a service is out of credit and opens the status tab', async () => {
    mockStatus = {
      isLoading: false,
      data: {
        services: [
          { id: 'serper', configured: true, health: 'exhausted', reachable: true },
          { id: 'tavily', configured: true, health: 'ok', reachable: true },
        ],
        chain: ['serper', 'tavily'],
        activeSearchProvider: 'tavily',
        lastServedBy: null,
        warningPercent: 20,
        warningDays: 7,
        refreshIntervalSeconds: 600,
        checkedAt: null,
      },
    };
    renderView();

    expect(screen.getByTestId('status-alert')).toBeInTheDocument();
    await userEvent.click(within(screen.getByTestId('status-alert')).getByRole('button'));
    expect(screen.getByRole('tab', { selected: true })).toHaveAttribute(
      'id',
      expect.stringContaining('status'),
    );
    expect(await screen.findByTestId('service-card-serper')).toBeInTheDocument();
  });

  it('shows no overview alert while the status loads', () => {
    renderView();
    expect(screen.queryByTestId('status-alert')).not.toBeInTheDocument();
  });
});
