import { act, render, screen, within } from '@testing-library/react';

/** The filter dropdown finishes mounting after the first render. */
const renderLog = async () => {
  render(<BrowserLog />);
  await act(async () => undefined);
};
import type { TAdminBrowserLogParams, TAdminBrowserLogResponse } from 'librechat-data-provider';
import BrowserLog from '../BrowserLog';

const mockQuery = jest.fn();

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}(${Object.values(values).join('|')})` : key,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { resolvedLanguage: 'en', language: 'en' } }),
}));

jest.mock('~/data-provider', () => ({
  useAdminBrowserLogQuery: (params: TAdminBrowserLogParams) => mockQuery(params),
}));

const page: TAdminBrowserLogResponse = {
  total: 2,
  limit: 25,
  offset: 0,
  entries: [
    {
      id: 'a',
      user: { id: 'u1', name: 'Sara', email: 'sara@example.com' },
      outcome: 'refused',
      reason: 'capacity',
      detail: 'cpu',
      startedAt: '2026-11-01T08:00:00.000Z',
      endedAt: '2026-11-01T08:00:00.000Z',
      domains: [],
    },
    {
      id: 'b',
      user: { id: 'u2', name: 'Ali' },
      sessionId: 's9',
      outcome: 'opened',
      reason: 'idle',
      startedAt: '2026-11-01T07:00:00.000Z',
      endedAt: '2026-11-01T07:04:00.000Z',
      durationMs: 240_000,
      domains: ['divar.ir'],
    },
  ],
};

describe('BrowserLog', () => {
  it('lists refusals with their cause and sessions with how they ended', async () => {
    mockQuery.mockReturnValue({ data: page, isLoading: false, isError: false });
    await renderLog();
    expect(mockQuery).toHaveBeenLastCalledWith({ limit: 25, offset: 0 });
    const [refused, opened] = screen.getAllByTestId('browser-log-row');
    expect(within(refused).getByText('Sara')).toBeInTheDocument();
    expect(
      within(refused).getByText(
        'com_admin_browser_reason_capacity (com_admin_server_blocking_cpu)',
      ),
    ).toBeInTheDocument();
    expect(within(opened).getByText('com_admin_browser_reason_idle')).toBeInTheDocument();
    expect(within(opened).getByText('4 minutes')).toBeInTheDocument();
    expect(within(opened).getByText('divar.ir')).toBeInTheDocument();
  });

  it('says when the log is empty', async () => {
    mockQuery.mockReturnValue({
      data: { total: 0, limit: 25, offset: 0, entries: [] },
      isLoading: false,
      isError: false,
    });
    await renderLog();
    expect(screen.getByText('com_admin_browser_log_empty')).toBeInTheDocument();
  });
});
