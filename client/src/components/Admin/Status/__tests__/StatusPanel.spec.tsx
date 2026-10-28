import userEvent from '@testing-library/user-event';
import { render, screen, within } from '@testing-library/react';
import type { TServiceStatusResponse } from 'librechat-data-provider';
import StatusPanel from '../StatusPanel';

let mockStatus: Record<string, unknown>;
let mockRefresh: Record<string, unknown>;
let mockCurrency: { code: string; rate: number } | undefined;
const mockRefetch = jest.fn();
const mockMutate = jest.fn();

/** Keys and their values, so assertions do not depend on translation copy. */
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, string>) =>
    values ? `${key}(${Object.values(values).join('|')})` : key,
}));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ i18n: { resolvedLanguage: 'fa', language: 'fa' } }),
}));
jest.mock('~/hooks/useBalanceSummary', () => ({
  useBalanceDisplay: () => ({ display: 'credits', currency: mockCurrency }),
}));
jest.mock('~/data-provider', () => ({
  useAdminServiceStatusQuery: () => mockStatus,
  useRefreshAdminServiceStatusMutation: () => mockRefresh,
}));

const NOW = Date.now();
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

const response: TServiceStatusResponse = {
  chain: ['serper', 'serpapi', 'tavily', 'searxng'],
  activeSearchProvider: 'serpapi',
  lastServedBy: null,
  warningPercent: 20,
  warningDays: 7,
  refreshIntervalSeconds: 600,
  checkedAt: iso(-5 * 60_000),
  services: [
    {
      id: 'serper',
      configured: true,
      health: 'exhausted',
      reachable: true,
      unit: 'credits',
      remaining: 0,
      skip: { reason: 'exhausted', until: iso(3600_000), code: 'serper_no_credits' },
      chainPosition: 1,
      checkedAt: iso(-5 * 60_000),
      errorCode: 'serper_no_credits',
    },
    {
      id: 'serpapi',
      configured: true,
      health: 'warning',
      reachable: true,
      unit: 'searches',
      remaining: 400,
      limit: 5000,
      remainingPercent: 8,
      usedThisPeriod: 4600,
      plan: 'Developer',
      resetAt: '2026-11-01',
      daysUntilExhausted: 4.6,
      chainPosition: 2,
      checkedAt: iso(-5 * 60_000),
    },
    {
      id: 'openrouter',
      configured: true,
      health: 'ok',
      reachable: true,
      unit: 'usd',
      remaining: 74.5,
      limit: 100,
      remainingPercent: 75,
      checkedAt: iso(-2 * 3600_000),
    },
    { id: 'sms', configured: false, health: 'unconfigured', reachable: null, checkedAt: null },
    {
      id: 'ollama',
      configured: true,
      health: 'ok',
      reachable: true,
      checkedAt: iso(-5 * 60_000),
      loadedKnown: true,
      models: [
        {
          name: 'gemma3:4b',
          loaded: true,
          parameterSize: '4.3B',
          quantization: 'Q4_K_M',
          sizeBytes: 3_300_000_000,
          vramBytes: 5_200_000_000,
          expiresAt: iso(5 * 60_000 + 1_000),
        },
        {
          name: 'qwen2.5:7b',
          loaded: false,
          parameterSize: '7.6B',
          quantization: 'Q4_K_M',
          sizeBytes: 4_700_000_000,
        },
      ],
    },
  ],
};

const withOllama = (patch: Partial<TServiceStatusResponse['services'][number]>) => ({
  ...response,
  services: response.services.map((row) => (row.id === 'ollama' ? { ...row, ...patch } : row)),
});

describe('StatusPanel', () => {
  beforeEach(() => {
    mockCurrency = undefined;
    mockRefresh = { mutate: mockMutate, isLoading: false, isError: false };
    mockStatus = { data: response, isLoading: false, isError: false, refetch: mockRefetch };
    jest.clearAllMocks();
  });

  it('shows skeletons while loading', () => {
    mockStatus = { isLoading: true, isError: false, refetch: mockRefetch };
    render(<StatusPanel />);

    expect(screen.getByTestId('status-loading')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByTestId('service-card-serper')).not.toBeInTheDocument();
  });

  it('shows an error with a retry when the status cannot load', async () => {
    mockStatus = { isLoading: false, isError: true, refetch: mockRefetch };
    render(<StatusPanel />);

    expect(screen.getByRole('alert')).toHaveTextContent('com_admin_status_load_error');
    await userEvent.click(screen.getByRole('button', { name: 'com_admin_status_retry' }));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('shows the empty state when there is nothing to report', () => {
    mockStatus = { data: { ...response, services: [] }, isLoading: false, isError: false };
    render(<StatusPanel />);

    expect(screen.getByText('com_admin_status_empty')).toBeInTheDocument();
  });

  it('renders a card per service with health, remaining, days left, reset and last check', () => {
    render(<StatusPanel />);

    const serper = screen.getByTestId('service-card-serper');
    expect(within(serper).getByTestId('health-exhausted')).toHaveTextContent(
      'com_admin_status_health_exhausted',
    );
    expect(within(serper).getByText(/com_admin_status_skip_exhausted/)).toBeInTheDocument();
    expect(within(serper).getByText('serper_no_credits')).toHaveAttribute('dir', 'ltr');

    const serpapi = screen.getByTestId('service-card-serpapi');
    expect(serpapi.className).toContain('border-status-warning-border');
    expect(within(serpapi).getByTestId('health-warning')).toBeInTheDocument();
    expect(within(serpapi).getByText('com_admin_status_days_left(۴)')).toBeInTheDocument();
    expect(
      within(serpapi).getByText(
        'com_admin_status_remaining_of(com_admin_status_unit_searches(۴۰۰)|com_admin_status_unit_searches(۵٬۰۰۰))',
      ),
    ).toBeInTheDocument();
    expect(within(serpapi).getByRole('progressbar')).toHaveAttribute(
      'aria-label',
      'com_admin_status_progress_label(com_admin_status_service_serpapi)',
    );
    expect(within(serpapi).getByText(/com_admin_status_reset\(.*۱۴۰۵/)).toBeInTheDocument();
    expect(within(serpapi).getByText('com_admin_status_active_badge')).toBeInTheDocument();
    expect(
      within(serpapi).getByText(/com_admin_status_checked\(۵ دقیقه پیش\)/),
    ).toBeInTheDocument();

    expect(
      within(screen.getByTestId('service-card-sms')).getByTestId('health-unconfigured'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('status-active')).toHaveTextContent(
      'com_admin_status_active(com_admin_status_service_serpapi)',
    );
  });

  it('shows OpenRouter dollars in Toman as well when a display currency is set', () => {
    mockCurrency = { code: 'IRT', rate: 100_000 };
    render(<StatusPanel />);

    expect(
      within(screen.getByTestId('service-card-openrouter')).getByText(/۷٬۴۵۰٬۰۰۰ تومان/),
    ).toBeInTheDocument();
  });

  it('lists the installed Ollama models and marks the active one', () => {
    render(<StatusPanel />);

    const card = screen.getByTestId('service-card-ollama');
    const section = within(card).getByRole('region', { name: 'com_admin_status_models_title' });
    expect(within(section).getByText('com_admin_status_models_summary(۲|۱)')).toBeInTheDocument();

    const gemma = within(section).getByTestId('ollama-model-gemma3:4b');
    const qwen = within(section).getByTestId('ollama-model-qwen2.5:7b');
    expect(within(gemma).getByText('gemma3:4b')).toHaveAttribute('dir', 'ltr');
    expect(within(gemma).getByText('com_admin_status_models_active')).toBeInTheDocument();
    expect(within(gemma).getByText(/com_admin_status_models_running/)).toBeInTheDocument();
    expect(within(gemma).getByText(/com_admin_status_models_vram\(۵٫۲/)).toBeInTheDocument();
    expect(
      within(gemma).getByText('com_admin_status_models_unloads(۵ دقیقه بعد)'),
    ).toBeInTheDocument();
    expect(within(qwen).getByText(/^7\.6B · Q4_K_M · ۴٫۷/)).toBeInTheDocument();
    expect(within(qwen).queryByText('com_admin_status_models_active')).not.toBeInTheDocument();
    expect(within(section).getAllByText('com_admin_status_models_active')).toHaveLength(1);
    expect(within(section).getAllByRole('listitem')[0]).toBe(gemma);
  });

  it('says when no model is loaded, when the loaded state is unknown and when none is installed', () => {
    const models = response.services.find((row) => row.id === 'ollama')?.models ?? [];
    const idle = models.map((model) => ({ ...model, loaded: false }));
    mockStatus = { data: withOllama({ models: idle }), isLoading: false, isError: false };
    const { rerender } = render(<StatusPanel />);
    const card = () => screen.getByTestId('service-card-ollama');
    expect(within(card()).getByText('com_admin_status_models_none_loaded')).toBeInTheDocument();
    expect(within(card()).getByText('com_admin_status_models_summary(۲|۰)')).toBeInTheDocument();

    mockStatus = {
      data: withOllama({ models: idle, loadedKnown: false }),
      isLoading: false,
      isError: false,
    };
    rerender(<StatusPanel />);
    expect(within(card()).getByText('com_admin_status_models_loaded_unknown')).toBeInTheDocument();
    expect(
      within(card()).getByText('com_admin_status_models_summary_installed(۲)'),
    ).toBeInTheDocument();
    expect(
      within(card()).queryByText('com_admin_status_models_none_loaded'),
    ).not.toBeInTheDocument();

    mockStatus = {
      data: withOllama({ models: [], errorCode: 'no_models', health: 'error' }),
      isLoading: false,
      isError: false,
    };
    rerender(<StatusPanel />);
    expect(within(card()).getByText('com_admin_status_models_empty')).toBeInTheDocument();
    expect(within(card()).queryByTestId('ollama-model-gemma3:4b')).not.toBeInTheDocument();
  });

  it('does not show a model as active once its unload time has passed', () => {
    const models = response.services.find((row) => row.id === 'ollama')?.models ?? [];
    const stale = models.map((model) =>
      model.loaded ? { ...model, expiresAt: iso(-60_000) } : model,
    );
    mockStatus = { data: withOllama({ models: stale }), isLoading: false, isError: false };
    render(<StatusPanel />);

    const card = screen.getByTestId('service-card-ollama');
    const gemma = within(card).getByTestId('ollama-model-gemma3:4b');
    expect(within(card).getByText('com_admin_status_models_summary(۲|۰)')).toBeInTheDocument();
    expect(within(card).queryByText('com_admin_status_models_active')).not.toBeInTheDocument();
    expect(within(gemma).queryByText(/com_admin_status_models_running/)).not.toBeInTheDocument();
    expect(within(gemma).getByText('com_admin_status_models_was_loaded')).toBeInTheDocument();
  });

  it('shows memory use on CPU-only hosts and flags a loaded model that is not installed', () => {
    const models = response.services.find((row) => row.id === 'ollama')?.models ?? [];
    mockStatus = {
      data: withOllama({
        models: [
          {
            name: 'phi4:latest',
            installed: false,
            loaded: true,
            sizeBytes: null,
            memoryBytes: 9_000_000_000,
            vramBytes: 0,
            expiresAt: iso(365 * 86_400_000),
          },
          ...models.map((model) => ({ ...model, loaded: false })),
        ],
      }),
      isLoading: false,
      isError: false,
    };
    render(<StatusPanel />);

    const card = screen.getByTestId('service-card-ollama');
    const phi = within(card).getByTestId('ollama-model-phi4:latest');
    expect(within(card).getByText('com_admin_status_models_summary(۲|۱)')).toBeInTheDocument();
    expect(within(phi).getByText('com_admin_status_models_active')).toBeInTheDocument();
    expect(within(phi).getByText('com_admin_status_models_not_installed')).toBeInTheDocument();
    const usage = within(phi).getByText(/com_admin_status_models_running/);
    expect(usage).toHaveTextContent(/com_admin_status_models_memory\(۹/);
    expect(usage).toHaveTextContent('com_admin_status_models_cpu');
    expect(usage).toHaveTextContent('com_admin_status_models_kept_loaded');
    expect(usage).not.toHaveTextContent('com_admin_status_models_vram');
  });

  it('refreshes on demand and reports a failed refresh', async () => {
    const { rerender } = render(<StatusPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'com_admin_status_refresh' }));
    expect(mockMutate).toHaveBeenCalled();

    mockRefresh = { mutate: mockMutate, isLoading: true, isError: false };
    rerender(<StatusPanel />);
    expect(screen.getByRole('button', { name: 'com_admin_status_refreshing' })).toBeDisabled();

    mockRefresh = { mutate: mockMutate, isLoading: false, isError: true };
    rerender(<StatusPanel />);
    expect(screen.getByRole('alert')).toHaveTextContent('com_admin_status_refresh_error');
  });
});
