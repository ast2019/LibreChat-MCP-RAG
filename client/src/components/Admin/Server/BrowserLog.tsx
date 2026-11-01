import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dropdown, Input, Skeleton } from '@librechat/client';
import { BROWSER_END_REASONS, BROWSER_REFUSALS } from 'librechat-data-provider';
import type { TAdminBrowserLogEntry, TBrowserLogFilter } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { formatDateTime, formatNumber } from '~/components/Admin/Status/format';
import { useAdminBrowserLogQuery } from '~/data-provider';
import { BLOCKING_KEYS } from './ServerPanel';
import { useLocalize } from '~/hooks';

const PAGE_SIZE = 25;
const SEARCH_DELAY_MS = 300;
const ALL = 'all';
const COLUMNS = [
  'com_admin_server_col_user',
  'com_admin_browser_log_col_time',
  'com_admin_browser_log_col_duration',
  'com_admin_server_col_sites',
  'com_admin_browser_log_col_result',
] as const;

export const REASON_KEYS: Record<NonNullable<TAdminBrowserLogEntry['reason']>, TranslationKeys> = {
  capacity: 'com_admin_browser_reason_capacity',
  server_full: 'com_admin_browser_reason_server_full',
  user_limit: 'com_admin_browser_reason_user_limit',
  not_allowed: 'com_admin_browser_reason_not_allowed',
  launch_failed: 'com_admin_browser_reason_launch_failed',
  unavailable: 'com_admin_browser_reason_unavailable',
  closed: 'com_admin_browser_reason_closed',
  idle: 'com_admin_browser_reason_idle',
  timeout: 'com_admin_browser_reason_timeout',
  admin: 'com_admin_browser_reason_admin',
  crashed: 'com_admin_browser_reason_crashed',
  shutdown: 'com_admin_browser_reason_shutdown',
  lost: 'com_admin_browser_reason_lost',
  replaced: 'com_admin_browser_reason_replaced',
};

/** «۳ دقیقه» / "45 seconds". */
function formatDuration(ms: number, locale: string) {
  const minutes = ms / 60_000;
  const unit = minutes >= 1 ? 'minute' : 'second';
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit,
    unitDisplay: 'long',
    maximumFractionDigits: 0,
  }).format(unit === 'minute' ? minutes : ms / 1000);
}

function Result({ entry }: { entry: TAdminBrowserLogEntry }) {
  const localize = useLocalize();
  if (!entry.reason) {
    return <span className="text-text-primary">{localize('com_admin_browser_reason_open')}</span>;
  }
  const detail =
    entry.reason === 'capacity' && (entry.detail === 'ram' || entry.detail === 'cpu')
      ? localize(BLOCKING_KEYS[entry.detail])
      : null;
  return (
    <span className={entry.outcome === 'refused' ? 'text-text-destructive' : 'text-text-primary'}>
      {localize(REASON_KEYS[entry.reason])}
      {detail && ` (${detail})`}
    </span>
  );
}

/**
 * The admin's «لاگ مرورگر»: every browser that opened, how it ended and the sites it opened,
 * and every request that was refused, with the user who made it. Newest first.
 */
export default function BrowserLog() {
  const localize = useLocalize();
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'fa';
  const searchId = useId();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<TBrowserLogFilter | typeof ALL>(ALL);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setOffset(0);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const log = useAdminBrowserLogQuery({
    search: search || undefined,
    filter: filter === ALL ? undefined : filter,
    limit: PAGE_SIZE,
    offset,
  });
  const total = log.data?.total ?? 0;

  const filterOptions = [
    { value: ALL, label: localize('com_admin_browser_log_all') },
    { value: 'refused', label: localize('com_admin_browser_log_refused') },
    { value: 'opened', label: localize('com_admin_browser_log_opened') },
    ...[...BROWSER_REFUSALS, ...BROWSER_END_REASONS].map((reason) => ({
      value: reason,
      label: localize(REASON_KEYS[reason]),
    })),
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-text-primary text-base font-semibold">
          {localize('com_admin_browser_log_title')}
        </h2>
        <p className="text-text-secondary text-sm">
          {localize('com_admin_browser_log_description')}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1 space-y-1">
          <label htmlFor={searchId} className="text-text-secondary block text-xs">
            {localize('com_admin_browser_log_search')}
          </label>
          <Input
            id={searchId}
            type="search"
            dir="auto"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>
        <Dropdown
          variant="compact"
          value={filter}
          options={filterOptions}
          onChange={(value) => {
            setFilter(value as TBrowserLogFilter | typeof ALL);
            setOffset(0);
          }}
          ariaLabel={localize('com_admin_browser_log_filter')}
          testId="browser-log-filter"
          sizeClasses="z-50"
        />
      </div>

      <div className="border-border-light overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="text-text-secondary text-xs">
            <tr>
              {COLUMNS.map((key) => (
                <th key={key} scope="col" className="px-3 py-2 text-start font-medium">
                  {localize(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {log.isLoading &&
              Array.from({ length: 4 }, (_, index) => (
                <tr key={index} className="border-border-light border-t">
                  <td colSpan={COLUMNS.length} className="px-3 py-2">
                    <Skeleton className="h-5 w-full" />
                  </td>
                </tr>
              ))}
            {log.isError && (
              <tr className="border-border-light border-t">
                <td colSpan={COLUMNS.length} className="px-3 py-4">
                  <span role="alert" className="text-text-destructive me-3">
                    {localize('com_admin_browser_log_error')}
                  </span>
                  <Button size="compact" variant="outline" onClick={() => log.refetch()}>
                    {localize('com_admin_status_retry')}
                  </Button>
                </td>
              </tr>
            )}
            {log.data != null && log.data.entries.length === 0 && (
              <tr className="border-border-light border-t">
                <td colSpan={COLUMNS.length} className="text-text-secondary px-3 py-6 text-center">
                  {localize('com_admin_browser_log_empty')}
                </td>
              </tr>
            )}
            {log.data?.entries.map((entry) => (
              <tr
                key={entry.id}
                className="border-border-light border-t"
                data-testid="browser-log-row"
              >
                <td className="px-3 py-2">
                  <div className="text-text-primary">{entry.user?.name || '—'}</div>
                  {entry.user?.email && (
                    <bdi dir="ltr" className="text-text-secondary text-xs">
                      {entry.user.email}
                    </bdi>
                  )}
                </td>
                <td className="text-text-secondary px-3 py-2">
                  {formatDateTime(entry.startedAt, locale)}
                </td>
                <td className="text-text-secondary px-3 py-2">
                  {entry.durationMs != null ? formatDuration(entry.durationMs, locale) : '—'}
                </td>
                <td className="text-text-secondary px-3 py-2">
                  <bdi dir="ltr">{entry.domains.join('، ') || '—'}</bdi>
                </td>
                <td className="px-3 py-2">
                  <Result entry={entry} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > PAGE_SIZE && (
        <nav
          aria-label={localize('com_admin_pagination')}
          className="flex items-center justify-between gap-3 text-sm"
        >
          <span className="text-text-secondary">
            {formatNumber(offset + 1, locale)}–
            {formatNumber(Math.min(offset + PAGE_SIZE, total), locale)} /{' '}
            {formatNumber(total, locale)}
          </span>
          <div className="flex gap-2">
            <Button
              size="compact"
              variant="outline"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              {localize('com_ui_prev')}
            </Button>
            <Button
              size="compact"
              variant="outline"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              {localize('com_ui_next')}
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}
