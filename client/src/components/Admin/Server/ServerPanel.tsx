import { useState } from 'react';
import { Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, EmptyState, Skeleton, Spinner, useToastContext } from '@librechat/client';
import type { TAdminServerStatus } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import {
  formatBytes,
  formatNumber,
  formatPercent,
  formatRelative,
  formatDateTime,
} from '~/components/Admin/Status/format';
import { useAdminServerStatusQuery, useAdminCloseBrowserMutation } from '~/data-provider';
import { Kpi } from '~/components/Billing/parts';
import { useLocalize } from '~/hooks';
import LoadChart from './LoadChart';

const STATE_KEYS: Record<TAdminServerStatus['state'], TranslationKeys> = {
  normal: 'com_admin_server_state_normal',
  warning: 'com_admin_server_state_warning',
  full: 'com_admin_server_state_full',
};

const STATE_STYLES: Record<TAdminServerStatus['state'], string> = {
  normal: 'border-status-success-border bg-status-success-subtle',
  warning: 'border-status-warning-border bg-status-warning-subtle',
  full: 'border-status-error-border bg-status-error-subtle',
};

export const BLOCKING_KEYS: Record<NonNullable<TAdminServerStatus['blocking']>, TranslationKeys> = {
  ram: 'com_admin_server_blocking_ram',
  cpu: 'com_admin_server_blocking_cpu',
  server_full: 'com_admin_server_blocking_server_full',
};

const toIso = (at: number) => new Date(at).toISOString();

/**
 * The admin's «وضعیت سرور»: RAM and CPU now and over 24 hours, whether a new browser would
 * open, and the open browsers with their owners and a force-close.
 */
export default function ServerPanel() {
  const localize = useLocalize();
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'fa';
  const { showToast } = useToastContext();
  const status = useAdminServerStatusQuery();
  const close = useAdminCloseBrowserMutation();
  const [closing, setClosing] = useState<string | null>(null);
  const data = status.data;
  const now = status.dataUpdatedAt || Date.now();
  const percent = (value: number | null | undefined) =>
    value == null ? undefined : formatPercent(value, locale);

  const closeBrowser = (id: string) => {
    setClosing(id);
    close.mutate(id, {
      onSuccess: () =>
        showToast({ status: 'success', message: localize('com_admin_server_closed') }),
      onError: () =>
        showToast({ status: 'error', message: localize('com_admin_server_close_error') }),
      onSettled: () => setClosing(null),
    });
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-text-primary text-base font-semibold">
          {localize('com_admin_server_title')}
        </h2>
        <p className="text-text-secondary text-sm">{localize('com_admin_server_description')}</p>
      </div>

      {status.isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-24 rounded-xl" />
          ))}
        </div>
      )}

      {status.isError && data == null && (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <p className="text-text-destructive text-sm">{localize('com_admin_server_load_error')}</p>
          <Button size="compact" variant="outline" onClick={() => status.refetch()}>
            {localize('com_admin_status_retry')}
          </Button>
        </div>
      )}

      {data != null && !data.enabled && (
        <p className="text-text-secondary text-sm" data-testid="server-browser-off">
          {localize('com_admin_server_off')}
        </p>
      )}

      {data != null && data.enabled && !data.reachable && (
        <p
          role="status"
          data-testid="server-unreachable"
          className="border-status-warning-border bg-status-warning-subtle text-text-primary rounded-xl border px-4 py-3 text-sm"
        >
          {localize('com_admin_server_unreachable')}
        </p>
      )}

      {data != null && data.reachable && (
        <>
          <p
            role="status"
            data-testid="server-state"
            data-state={data.state}
            className={`text-text-primary rounded-xl border px-4 py-3 text-sm font-medium ${STATE_STYLES[data.state]}`}
          >
            {localize(STATE_KEYS[data.state], {
              0: data.blocking ? localize(BLOCKING_KEYS[data.blocking]) : '',
            })}
          </p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              label={localize('com_admin_server_ram')}
              value={percent(data.ram?.percent) ?? '—'}
              hint={localize('com_admin_server_ram_hint', {
                0: data.ram ? formatBytes(data.ram.used, locale) : '—',
                1: data.ram ? formatBytes(data.ram.total, locale) : '—',
                2: formatPercent(data.limits.ram, locale),
              })}
            />
            <Kpi
              label={localize('com_admin_server_cpu')}
              value={percent(data.cpu) ?? '—'}
              hint={localize('com_admin_server_cpu_hint', {
                0: formatPercent(data.limits.cpu, locale),
              })}
            />
            {data.container && (
              <Kpi
                label={localize('com_admin_server_container')}
                value={percent(data.container.percent) ?? '—'}
                hint={localize('com_admin_server_container_hint', {
                  0: formatBytes(data.container.used, locale),
                  1: formatBytes(data.container.limit, locale),
                })}
              />
            )}
            <Kpi
              label={localize('com_admin_server_sessions')}
              value={`${formatNumber(data.sessions.length, locale)} / ${formatNumber(data.limits.maxSessions, locale)}`}
              hint={localize('com_admin_server_sessions_hint', {
                0: formatNumber(data.limits.idleMinutes, locale, 1),
                1: formatNumber(data.limits.maxMinutes, locale),
              })}
            />
          </div>

          <LoadChart history={data.history} limits={data.limits} locale={locale} />

          <section aria-labelledby="server-open-browsers" className="space-y-2">
            <h3 id="server-open-browsers" className="text-text-primary text-sm font-medium">
              {localize('com_admin_server_sessions')}
            </h3>
            {data.sessions.length === 0 ? (
              <EmptyState icon={Globe} description={localize('com_admin_server_open_empty')} />
            ) : (
              <div className="border-border-light overflow-x-auto rounded-xl border">
                <table className="w-full text-sm">
                  <thead className="text-text-secondary text-xs">
                    <tr>
                      {(
                        [
                          'com_admin_server_col_user',
                          'com_admin_server_col_started',
                          'com_admin_server_col_active',
                          'com_admin_server_col_sites',
                        ] as const
                      ).map((key) => (
                        <th key={key} scope="col" className="px-3 py-2 text-start font-medium">
                          {localize(key)}
                        </th>
                      ))}
                      <th scope="col" className="px-3 py-2">
                        <span className="sr-only">{localize('com_admin_server_close')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sessions.map((session) => {
                      const owner =
                        session.user?.name || session.user?.email || session.user?.id || '—';
                      return (
                        <tr
                          key={session.id}
                          className="border-border-light border-t"
                          data-testid="server-session"
                        >
                          <td className="px-3 py-2">
                            <div className="text-text-primary">{session.user?.name || '—'}</div>
                            {session.user?.email && (
                              <bdi dir="ltr" className="text-text-secondary text-xs">
                                {session.user.email}
                              </bdi>
                            )}
                          </td>
                          <td className="text-text-secondary px-3 py-2">
                            {formatDateTime(toIso(session.startedAt), locale)}
                          </td>
                          <td className="text-text-secondary px-3 py-2">
                            {formatRelative(toIso(session.lastActiveAt), now, locale)}
                          </td>
                          <td className="text-text-secondary px-3 py-2">
                            <bdi dir="ltr">{session.domains.join('، ') || '—'}</bdi>
                          </td>
                          <td className="px-3 py-2 text-end">
                            <Button
                              size="compact"
                              variant="outline"
                              onClick={() => closeBrowser(session.id)}
                              disabled={closing === session.id}
                              aria-busy={closing === session.id}
                              aria-label={localize('com_admin_server_close_aria', { 0: owner })}
                            >
                              {closing === session.id && (
                                <Spinner className="me-1.5 size-3.5" aria-hidden="true" />
                              )}
                              {localize('com_admin_server_close')}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
