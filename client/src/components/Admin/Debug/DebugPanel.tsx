import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dropdown, Input, Skeleton, Switch, useToastContext } from '@librechat/client';
import {
  DEBUG_LOG_LEVELS,
  DEBUG_MODE_MINUTES,
  DEBUG_MODE_DEFAULT_MINUTES,
} from 'librechat-data-provider';
import type { TDebugLogLevel, TDebugTrace, TDebugLogLine } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import {
  useAdminDebugModeQuery,
  useAdminDebugTraceQuery,
  useAdminDebugTracesQuery,
  useAdminDebugModeMutation,
  useAdminDebugSystemLogQuery,
  useAdminClearDebugTracesMutation,
} from '~/data-provider';
import { formatDateTime, formatNumber } from '~/components/Admin/Status/format';
import { useLocalize } from '~/hooks';

const PAGE_SIZE = 25;
const SEARCH_DELAY_MS = 300;

const LEVEL_KEYS: Record<TDebugLogLevel, TranslationKeys> = {
  error: 'com_admin_debug_level_error',
  warn: 'com_admin_debug_level_warn',
  info: 'com_admin_debug_level_info',
  debug: 'com_admin_debug_level_debug',
};

/** Known stages get a readable name; any other stage shows its own name. */
const STAGE_KEYS: Record<string, TranslationKeys> = {
  request: 'com_admin_debug_stage_request',
  ephemeral_agent: 'com_admin_debug_stage_ephemeral_agent',
  browser_gate: 'com_admin_debug_stage_browser_gate',
  tool_definitions: 'com_admin_debug_stage_tool_definitions',
  model_tools: 'com_admin_debug_stage_model_tools',
  response: 'com_admin_debug_stage_response',
};

const levelClass = (level: string) => {
  if (level === 'error') {
    return 'text-text-destructive';
  }
  return level === 'warn' ? 'text-status-warning' : 'text-text-secondary';
};

/** Tools a trace's loaders dropped, with why: the usual answer to "the model has no tool". */
export function droppedTools(trace: TDebugTrace): Array<{ name: string; reason: string }> {
  const dropped: Array<{ name: string; reason: string }> = [];
  for (const stage of trace.stages) {
    const data = stage.data as { skipped?: Array<{ name: string; reason: string }> } | undefined;
    if (stage.name === 'tool_definitions' && Array.isArray(data?.skipped)) {
      dropped.push(...data.skipped);
    }
  }
  return dropped;
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

function LogLines({ lines, locale }: { lines: TDebugLogLine[]; locale: string }) {
  const localize = useLocalize();
  if (lines.length === 0) {
    return <p className="text-text-secondary text-sm">{localize('com_admin_debug_no_logs')}</p>;
  }
  return (
    <ol
      dir="ltr"
      className="bg-surface-secondary max-h-96 space-y-1 overflow-auto rounded-lg p-3 font-mono text-xs"
    >
      {lines.map((line, index) => (
        <li key={`${line.at}-${index}`} className="break-words whitespace-pre-wrap">
          <span className="text-text-secondary">{formatDateTime(line.at, locale)} </span>
          <span className={levelClass(line.level)}>{line.level}</span>{' '}
          <span className="text-text-primary">{line.message}</span>
          {line.meta && <span className="text-text-secondary"> {line.meta}</span>}
        </li>
      ))}
    </ol>
  );
}

function TraceDetail({ traceId, locale }: { traceId: string; locale: string }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const trace = useAdminDebugTraceQuery(traceId);

  if (trace.isLoading) {
    return <Skeleton className="h-32 w-full" />;
  }
  if (trace.isError || !trace.data) {
    return (
      <p role="alert" className="text-text-destructive text-sm">
        {localize('com_admin_debug_trace_error')}
      </p>
    );
  }
  const data = trace.data;
  const dropped = droppedTools(data);

  return (
    <div className="space-y-4" data-testid="debug-trace-detail">
      <div className="flex flex-wrap items-center gap-2">
        <bdi dir="ltr" className="text-text-secondary font-mono text-xs">
          {data.id}
        </bdi>
        <Button
          size="compact"
          variant="outline"
          onClick={() =>
            copyText(JSON.stringify(data, null, 2)).then(
              () => showToast({ status: 'success', message: localize('com_ui_copied') }),
              () => showToast({ status: 'error', message: localize('com_admin_debug_copy_error') }),
            )
          }
        >
          {localize('com_admin_debug_copy_json')}
        </Button>
      </div>

      {dropped.length > 0 && (
        <div
          role="status"
          className="border-status-warning-border bg-status-warning-subtle rounded-lg border p-3 text-sm"
        >
          <p className="text-text-primary font-medium">{localize('com_admin_debug_dropped')}</p>
          <ul dir="ltr" className="mt-1 font-mono text-xs">
            {dropped.map((item) => (
              <li key={`${item.name}-${item.reason}`}>
                {item.name} — {item.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-2">
        <h4 className="text-text-primary text-sm font-semibold">
          {localize('com_admin_debug_stages')}
        </h4>
        <ol className="space-y-2">
          {data.stages.map((stage, index) => (
            <li key={`${stage.name}-${index}`} className="border-border-light rounded-lg border">
              <details open={stage.name !== 'request' && stage.name !== 'response'}>
                <summary className="text-text-primary cursor-pointer px-3 py-2 text-sm">
                  {STAGE_KEYS[stage.name] ? localize(STAGE_KEYS[stage.name]) : stage.name}{' '}
                  <bdi dir="ltr" className="text-text-secondary font-mono text-xs">
                    {stage.name} · {formatDateTime(stage.at, locale)}
                  </bdi>
                </summary>
                {stage.data !== undefined && (
                  <pre
                    dir="ltr"
                    className="bg-surface-secondary max-h-80 overflow-auto px-3 py-2 text-xs"
                  >
                    {JSON.stringify(stage.data, null, 2)}
                  </pre>
                )}
              </details>
            </li>
          ))}
        </ol>
      </div>

      <div className="space-y-2">
        <h4 className="text-text-primary text-sm font-semibold">
          {localize('com_admin_debug_trace_logs')}
        </h4>
        <LogLines lines={data.logs} locale={locale} />
      </div>
    </div>
  );
}

function DebugSwitch({ locale }: { locale: string }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const switchId = useId();
  const mode = useAdminDebugModeQuery();
  const update = useAdminDebugModeMutation();
  const [minutes, setMinutes] = useState<number>(DEBUG_MODE_DEFAULT_MINUTES);
  const [level, setLevel] = useState<TDebugLogLevel>('debug');
  const enabled = mode.data?.enabled === true;

  const toggle = (next: boolean) =>
    update.mutate(next ? { enabled: true, minutes, level } : { enabled: false }, {
      onError: () => showToast({ status: 'error', message: localize('com_admin_save_error') }),
    });

  return (
    <section
      aria-labelledby="admin-debug-switch"
      className="border-border-light space-y-3 rounded-xl border p-4"
    >
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <label
            id="admin-debug-switch"
            htmlFor={switchId}
            className="text-text-primary text-sm font-medium"
          >
            {localize('com_admin_debug_switch')}
          </label>
          <p className="text-text-secondary mt-1 text-xs">
            {localize('com_admin_debug_switch_desc')}
          </p>
        </div>
        {mode.isLoading ? (
          <Skeleton className="h-6 w-11" />
        ) : (
          <Switch
            id={switchId}
            aria-labelledby="admin-debug-switch"
            checked={enabled}
            disabled={update.isLoading || mode.isError}
            onCheckedChange={toggle}
            data-testid="admin-debug-switch"
          />
        )}
      </div>

      {mode.isError && (
        <p role="alert" className="text-text-destructive text-sm">
          {localize('com_admin_debug_mode_error')}
        </p>
      )}

      {enabled && mode.data?.enabledUntil ? (
        <p className="text-text-primary text-sm" data-testid="admin-debug-until">
          {localize('com_admin_debug_on_until', {
            0: formatDateTime(mode.data.enabledUntil, locale),
            1: localize(LEVEL_KEYS[mode.data.level]),
          })}
        </p>
      ) : (
        !mode.isLoading &&
        !mode.isError && (
          <div className="flex flex-wrap gap-3">
            <Dropdown
              variant="compact"
              value={String(minutes)}
              options={DEBUG_MODE_MINUTES.map((value) => ({
                value: String(value),
                label: localize('com_admin_debug_minutes', { 0: formatNumber(value, locale) }),
              }))}
              onChange={(value) => setMinutes(Number(value))}
              ariaLabel={localize('com_admin_debug_duration')}
              testId="admin-debug-minutes"
              sizeClasses="z-50"
            />
            <Dropdown
              variant="compact"
              value={level}
              options={DEBUG_LOG_LEVELS.map((value) => ({
                value,
                label: localize(LEVEL_KEYS[value]),
              }))}
              onChange={(value) => setLevel(value as TDebugLogLevel)}
              ariaLabel={localize('com_admin_debug_level')}
              testId="admin-debug-level"
              sizeClasses="z-50"
            />
          </div>
        )
      )}
      <p className="text-text-secondary text-xs">{localize('com_admin_debug_privacy')}</p>
    </section>
  );
}

function SystemLog({ locale, live }: { locale: string; live: boolean }) {
  const localize = useLocalize();
  const [open, setOpen] = useState(false);
  const log = useAdminDebugSystemLogQuery(open, live);

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-text-primary flex-1 text-sm font-semibold">
          {localize('com_admin_debug_system_log')}
        </h3>
        <Button
          size="compact"
          variant="outline"
          onClick={() => (open ? log.refetch() : setOpen(true))}
        >
          {localize(open ? 'com_ui_refresh' : 'com_admin_debug_show')}
        </Button>
      </div>
      <p className="text-text-secondary text-xs">{localize('com_admin_debug_system_log_desc')}</p>
      {open && log.isLoading && <Skeleton className="h-24 w-full" />}
      {open && log.isError && (
        <p role="alert" className="text-text-destructive text-sm">
          {localize('com_admin_debug_trace_error')}
        </p>
      )}
      {open && log.data && <LogLines lines={[...log.data.lines].reverse()} locale={locale} />}
    </section>
  );
}

/**
 * The admin's «دیباگ»: a switch that turns debug mode on for a while, the chat requests it
 * traced (what each step decided and which tools reached the model) and this server's recent
 * log lines.
 */
export default function DebugPanel() {
  const localize = useLocalize();
  const { i18n } = useTranslation();
  const { showToast } = useToastContext();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'fa';
  const searchId = useId();
  const problemsId = useId();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [problems, setProblems] = useState(false);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const mode = useAdminDebugModeQuery();
  const live = mode.data?.enabled === true;
  const clear = useAdminClearDebugTracesMutation();

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setOffset(0);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const traces = useAdminDebugTracesQuery(
    { search: search || undefined, problems: problems || undefined, limit: PAGE_SIZE, offset },
    live,
  );
  const total = traces.data?.total ?? 0;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-text-primary text-base font-semibold">
          {localize('com_admin_debug_title')}
        </h2>
        <p className="text-text-secondary text-sm">{localize('com_admin_debug_description')}</p>
      </div>

      <DebugSwitch locale={locale} />

      <section className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1 space-y-1">
            <label htmlFor={searchId} className="text-text-secondary block text-xs">
              {localize('com_admin_debug_search')}
            </label>
            <Input
              id={searchId}
              type="search"
              dir="auto"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </div>
          <label htmlFor={problemsId} className="text-text-primary flex items-center gap-2 text-sm">
            <input
              id={problemsId}
              type="checkbox"
              checked={problems}
              onChange={(event) => {
                setProblems(event.target.checked);
                setOffset(0);
              }}
            />
            {localize('com_admin_debug_problems_only')}
          </label>
          <Button
            size="compact"
            variant="outline"
            disabled={clear.isLoading || total === 0}
            onClick={() => {
              if (window.confirm(localize('com_admin_debug_clear_confirm'))) {
                clear.mutate(undefined, {
                  onSuccess: () => setSelected(null),
                  onError: () =>
                    showToast({ status: 'error', message: localize('com_admin_save_error') }),
                });
              }
            }}
          >
            {localize('com_admin_debug_clear')}
          </Button>
        </div>

        <div className="border-border-light overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="text-text-secondary text-xs">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {localize('com_admin_debug_col_time')}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {localize('com_admin_server_col_user')}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {localize('com_admin_debug_col_model')}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {localize('com_admin_debug_col_problems')}
                </th>
              </tr>
            </thead>
            <tbody>
              {traces.isLoading &&
                Array.from({ length: 3 }, (_, index) => (
                  <tr key={index} className="border-border-light border-t">
                    <td colSpan={4} className="px-3 py-2">
                      <Skeleton className="h-5 w-full" />
                    </td>
                  </tr>
                ))}
              {traces.isError && (
                <tr className="border-border-light border-t">
                  <td colSpan={4} className="px-3 py-4">
                    <span role="alert" className="text-text-destructive me-3">
                      {localize('com_admin_debug_trace_error')}
                    </span>
                    <Button size="compact" variant="outline" onClick={() => traces.refetch()}>
                      {localize('com_admin_status_retry')}
                    </Button>
                  </td>
                </tr>
              )}
              {traces.data != null && traces.data.entries.length === 0 && (
                <tr className="border-border-light border-t">
                  <td colSpan={4} className="text-text-secondary px-3 py-6 text-center">
                    {localize(live ? 'com_admin_debug_empty_on' : 'com_admin_debug_empty_off')}
                  </td>
                </tr>
              )}
              {traces.data?.entries.map((entry) => (
                <tr
                  key={entry.id}
                  className={`border-border-light hover:bg-surface-hover cursor-pointer border-t ${
                    selected === entry.id ? 'bg-surface-secondary' : ''
                  }`}
                  data-testid="debug-trace-row"
                  aria-selected={selected === entry.id}
                  tabIndex={0}
                  onClick={() => setSelected(selected === entry.id ? null : entry.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelected(selected === entry.id ? null : entry.id);
                    }
                  }}
                >
                  <td className="text-text-secondary px-3 py-2">
                    {formatDateTime(entry.startedAt, locale)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-text-primary">{entry.user?.name || '—'}</div>
                    {entry.user?.email && (
                      <bdi dir="ltr" className="text-text-secondary text-xs">
                        {entry.user.email}
                      </bdi>
                    )}
                  </td>
                  <td className="text-text-secondary px-3 py-2">
                    <bdi dir="ltr">{entry.spec || entry.model || entry.endpoint || '—'}</bdi>
                  </td>
                  <td className="px-3 py-2">
                    {entry.errorCount === 0 && entry.warnCount === 0 ? (
                      <span className="text-text-secondary">—</span>
                    ) : (
                      <span
                        className={
                          entry.errorCount > 0 ? 'text-text-destructive' : 'text-status-warning'
                        }
                      >
                        {localize('com_admin_debug_counts', {
                          0: formatNumber(entry.errorCount, locale),
                          1: formatNumber(entry.warnCount, locale),
                        })}
                      </span>
                    )}
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

        {selected && (
          <div className="border-border-light rounded-xl border p-4">
            <TraceDetail traceId={selected} locale={locale} />
          </div>
        )}
      </section>

      <SystemLog locale={locale} live={live} />
    </div>
  );
}
