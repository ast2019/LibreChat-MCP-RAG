import userEvent from '@testing-library/user-event';
import { render, screen, within } from '@testing-library/react';
import type { TAdminServerStatus } from 'librechat-data-provider';
import ServerPanel from '../ServerPanel';

const mockClose = jest.fn();
const mockShowToast = jest.fn();
let mockStatus: { data?: TAdminServerStatus; isLoading: boolean; isError: boolean };

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}(${Object.values(values).join('|')})` : key,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { resolvedLanguage: 'en', language: 'en' } }),
}));

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

jest.mock('~/data-provider', () => ({
  useAdminServerStatusQuery: () => ({
    ...mockStatus,
    dataUpdatedAt: 1_000_000,
    refetch: jest.fn(),
  }),
  useAdminCloseBrowserMutation: () => ({ mutate: mockClose }),
}));

const status = (overrides: Partial<TAdminServerStatus> = {}): TAdminServerStatus => ({
  enabled: true,
  reachable: true,
  state: 'normal',
  blocking: null,
  ram: { percent: 62, used: 20e9, total: 32e9 },
  cpu: 18,
  container: { percent: 30, used: 1.8e9, limit: 6e9 },
  limits: { ram: 85, cpu: 90, maxSessions: 10, idleMinutes: 3, maxMinutes: 20 },
  sessions: [
    {
      id: 's1',
      user: { id: 'u1', name: 'Sara', email: 'sara@example.com' },
      startedAt: 900_000,
      lastActiveAt: 990_000,
      domains: ['www.digikala.com', 'torob.com'],
    },
  ],
  history: [
    { at: 1, ram: 50, cpu: 10, container: 20, sessions: 0 },
    { at: 2, ram: 62, cpu: 18, container: 30, sessions: 1 },
  ],
  checkedAt: 1_000_000,
  ...overrides,
});

describe('ServerPanel', () => {
  beforeEach(() => {
    mockClose.mockReset();
    mockShowToast.mockReset();
  });

  it('shows the load against the owner’s limits and who has a browser open', () => {
    mockStatus = { data: status(), isLoading: false, isError: false };
    render(<ServerPanel />);
    expect(screen.getByTestId('server-state')).toHaveAttribute('data-state', 'normal');
    expect(screen.getByText('62%')).toBeInTheDocument();
    expect(screen.getByText(/com_admin_server_cpu_hint\(90%\)/)).toBeInTheDocument();
    expect(screen.getByText('1 / 10')).toBeInTheDocument();
    const row = screen.getByTestId('server-session');
    expect(within(row).getByText('Sara')).toBeInTheDocument();
    expect(within(row).getByText('www.digikala.com، torob.com')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAccessibleName('com_admin_server_chart_label(62%|18%)');
  });

  it('force-closes a browser and says so', async () => {
    mockStatus = { data: status(), isLoading: false, isError: false };
    mockClose.mockImplementation((_id, options) => {
      options.onSuccess();
      options.onSettled();
    });
    render(<ServerPanel />);
    await userEvent.click(
      screen.getByRole('button', { name: 'com_admin_server_close_aria(Sara)' }),
    );
    expect(mockClose).toHaveBeenCalledWith('s1', expect.any(Object));
    expect(mockShowToast).toHaveBeenCalledWith({
      status: 'success',
      message: 'com_admin_server_closed',
    });
  });

  it('names what blocks new browsers when the server is full', () => {
    mockStatus = {
      data: status({ state: 'full', blocking: 'ram', sessions: [] }),
      isLoading: false,
      isError: false,
    };
    render(<ServerPanel />);
    expect(screen.getByTestId('server-state')).toHaveTextContent(
      'com_admin_server_state_full(com_admin_server_blocking_ram)',
    );
    expect(screen.getByText('com_admin_server_open_empty')).toBeInTheDocument();
  });

  it('says the service is unreachable instead of showing empty figures', () => {
    mockStatus = {
      data: status({ reachable: false, sessions: [] }),
      isLoading: false,
      isError: false,
    };
    render(<ServerPanel />);
    expect(screen.getByTestId('server-unreachable')).toBeInTheDocument();
    expect(screen.queryByTestId('server-state')).toBeNull();
  });
});
