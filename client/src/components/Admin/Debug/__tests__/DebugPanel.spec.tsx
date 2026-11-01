import { act, fireEvent, render, screen } from '@testing-library/react';
import type { TDebugTrace, TDebugTraceListResponse } from 'librechat-data-provider';
import DebugPanel from '../DebugPanel';

const mockMode = jest.fn();
const mockTraces = jest.fn();
const mockTrace = jest.fn();
const mockMutate = jest.fn();

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}(${Object.values(values).join('|')})` : key,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { resolvedLanguage: 'en', language: 'en' } }),
}));

jest.mock('@librechat/client', () => {
  const actual = jest.requireActual('@librechat/client');
  return { ...actual, useToastContext: () => ({ showToast: jest.fn() }) };
});

jest.mock('~/data-provider', () => ({
  useAdminDebugModeQuery: () => mockMode(),
  useAdminDebugModeMutation: () => ({ mutate: mockMutate, isLoading: false }),
  useAdminDebugTracesQuery: (params: unknown, live: boolean) => mockTraces(params, live),
  useAdminDebugTraceQuery: (id: string | null) => mockTrace(id),
  useAdminDebugSystemLogQuery: () => ({ data: undefined, isLoading: false, isError: false }),
  useAdminClearDebugTracesMutation: () => ({ mutate: jest.fn(), isLoading: false }),
}));

const off = {
  enabled: false,
  enabledUntil: null,
  enabledBy: null,
  level: 'warn',
  systemLogLines: 0,
};

const page: TDebugTraceListResponse = {
  total: 1,
  limit: 25,
  offset: 0,
  entries: [
    {
      id: 't1',
      user: { id: 'u1', name: 'Sara' },
      spec: 'ChatGPT Mini',
      startedAt: '2026-11-01T08:00:00.000Z',
      stageCount: 3,
      logCount: 1,
      errorCount: 0,
      warnCount: 1,
    },
  ],
};

const trace: TDebugTrace = {
  ...page.entries[0],
  stages: [
    {
      name: 'tool_definitions',
      at: '2026-11-01T08:00:01.000Z',
      data: {
        requested: ['browser_open'],
        skipped: [{ name: 'browser_open', reason: 'not_built_in' }],
      },
    },
  ],
  logs: [],
};

const renderPanel = async () => {
  render(<DebugPanel />);
  await act(async () => undefined);
};

describe('DebugPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTrace.mockReturnValue({ data: undefined, isLoading: false, isError: false });
  });

  it('turns debug mode on with the chosen duration and level', async () => {
    mockMode.mockReturnValue({ data: off, isLoading: false, isError: false });
    mockTraces.mockReturnValue({
      data: { ...page, total: 0, entries: [] },
      isLoading: false,
      isError: false,
    });
    await renderPanel();
    expect(screen.getByText('com_admin_debug_empty_off')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('admin-debug-switch'));
    expect(mockMutate).toHaveBeenCalledWith(
      { enabled: true, minutes: 30, level: 'debug' },
      expect.any(Object),
    );
  });

  it('shows when debug mode ends while it is on, and polls traces', async () => {
    mockMode.mockReturnValue({
      data: { ...off, enabled: true, enabledUntil: '2026-11-01T09:00:00.000Z', level: 'debug' },
      isLoading: false,
      isError: false,
    });
    mockTraces.mockReturnValue({ data: page, isLoading: false, isError: false });
    await renderPanel();
    expect(screen.getByTestId('admin-debug-until')).toBeInTheDocument();
    expect(mockTraces).toHaveBeenLastCalledWith({ limit: 25, offset: 0 }, true);
  });

  it('opens a trace and lists the tools dropped before the model', async () => {
    mockMode.mockReturnValue({ data: off, isLoading: false, isError: false });
    mockTraces.mockReturnValue({ data: page, isLoading: false, isError: false });
    mockTrace.mockImplementation((id: string | null) =>
      id ? { data: trace, isLoading: false, isError: false } : { data: undefined },
    );
    await renderPanel();
    fireEvent.click(screen.getByTestId('debug-trace-row'));
    expect(screen.getByTestId('debug-trace-detail')).toBeInTheDocument();
    expect(screen.getByText('com_admin_debug_dropped')).toBeInTheDocument();
    expect(screen.getByText('browser_open — not_built_in')).toBeInTheDocument();
  });
});
