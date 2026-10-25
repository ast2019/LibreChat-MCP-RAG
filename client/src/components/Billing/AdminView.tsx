import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { SystemRoles } from 'librechat-data-provider';
import { Button, Input, Progress, Skeleton } from '@librechat/client';
import type { TAdminBillingUser } from 'librechat-data-provider';
import {
  useAdminBillingUsersQuery,
  useAdminBillingPacksQuery,
  useAdminBillingSummaryQuery,
} from '~/data-provider';
import { useAuthContext, useDocumentTitle, useLocalize } from '~/hooks';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';
import GrantDialog from './GrantDialog';
import { formatUsd } from './format';

const WINDOWS = [7, 30, 90] as const;
const PAGE_SIZE = 25;
const SEARCH_DELAY_MS = 300;

function Kpi({ label, value, hint }: { label: string; value?: string; hint?: string }) {
  return (
    <div className="border-border-light bg-surface-secondary rounded-xl border p-4">
      <div className="text-text-secondary text-xs">{label}</div>
      {value == null ? (
        <Skeleton className="mt-2 h-6 w-20" />
      ) : (
        <div className="text-text-primary mt-1 text-xl font-semibold">{value}</div>
      )}
      {hint != null && <div className="text-text-secondary mt-1 text-xs">{hint}</div>}
    </div>
  );
}

function UsageCell({ user }: { user: TAdminBillingUser }) {
  const localize = useLocalize();
  if (user.usedPercent == null) {
    return <span className="text-text-secondary text-xs">—</span>;
  }
  return (
    <div className="flex min-w-[7rem] items-center gap-2">
      <Progress
        value={user.usedPercent}
        aria-label={localize('com_ui_balance_used_label')}
        variant={user.usedPercent >= 90 ? 'warning' : 'default'}
        className="flex-1"
      />
      <span className="text-text-secondary w-9 text-end text-xs">{user.usedPercent}%</span>
    </div>
  );
}

/** Admin-only billing page: what was sold and spent, and every user's credit. */
export default function AdminView() {
  const localize = useLocalize();
  const { user } = useAuthContext();
  const isAdmin = user?.role === SystemRoles.ADMIN;
  const [days, setDays] = useState<number>(30);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [granting, setGranting] = useState<TAdminBillingUser | null>(null);

  useDocumentTitle(localize('com_admin_title'));

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setOffset(0);
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  const summary = useAdminBillingSummaryQuery(days, { enabled: isAdmin });
  const users = useAdminBillingUsersQuery(
    { search: search || undefined, limit: PAGE_SIZE, offset },
    { enabled: isAdmin },
  );
  const packs = useAdminBillingPacksQuery({ enabled: isAdmin });

  if (user != null && !isAdmin) {
    return <Navigate to="/c/new" replace={true} />;
  }

  const data = summary.data;
  const margin = data ? data.creditsSpentInWindow - data.estimatedProviderCredits : undefined;
  const total = users.data?.total ?? 0;

  return (
    <main className="bg-surface-primary h-full overflow-y-auto" aria-labelledby="admin-title">
      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6">
        <header className="flex flex-wrap items-center gap-3">
          <OpenSidebar />
          <h1 id="admin-title" className="text-text-primary flex-1 text-2xl font-semibold">
            {localize('com_admin_title')}
          </h1>
          <div role="group" aria-label={localize('com_admin_window')} className="flex gap-1">
            {WINDOWS.map((value) => (
              <Button
                key={value}
                size="compact"
                variant={days === value ? 'default' : 'outline'}
                aria-pressed={days === value}
                onClick={() => setDays(value)}
              >
                {localize('com_admin_days', { 0: String(value) })}
              </Button>
            ))}
          </div>
        </header>

        {summary.isError ? (
          <p role="alert" className="text-text-destructive text-sm">
            {localize('com_admin_load_error')}
          </p>
        ) : (
          <section
            aria-label={localize('com_admin_summary')}
            className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6"
          >
            <Kpi
              label={localize('com_admin_users')}
              value={data ? String(data.totalUsers) : undefined}
              hint={
                data ? localize('com_admin_active', { 0: String(data.activeUsers) }) : undefined
              }
            />
            <Kpi
              label={localize('com_admin_granted')}
              value={data ? formatUsd(data.creditsGrantedInWindow) : undefined}
              hint={
                data
                  ? localize('com_admin_packs_count', { 0: String(data.packGrantsInWindow) })
                  : undefined
              }
            />
            <Kpi
              label={localize('com_admin_spent')}
              value={data ? formatUsd(data.creditsSpentInWindow) : undefined}
            />
            <Kpi
              label={localize('com_admin_provider_cost')}
              value={data ? formatUsd(data.estimatedProviderCredits) : undefined}
              hint={data ? `×${data.priceMultiplier}` : undefined}
            />
            <Kpi
              label={localize('com_admin_margin')}
              value={margin != null ? formatUsd(margin) : undefined}
            />
            <Kpi
              label={localize('com_admin_outstanding')}
              value={data ? formatUsd(data.creditsOutstanding) : undefined}
            />
          </section>
        )}

        {data && data.topModels.length > 0 && (
          <section aria-labelledby="admin-models" className="space-y-2">
            <h2 id="admin-models" className="text-text-primary text-sm font-medium">
              {localize('com_admin_top_models')}
            </h2>
            <ul className="border-border-light divide-border-light divide-y rounded-xl border">
              {data.topModels.map((row) => (
                <li key={row.model} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span className="text-text-primary truncate font-mono text-xs">{row.model}</span>
                  <span className="text-text-secondary">{formatUsd(row.credits)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="admin-users" className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="admin-users" className="text-text-primary flex-1 text-sm font-medium">
              {localize('com_admin_user_list')}
            </h2>
            <div className="w-full max-w-xs">
              <Input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder={localize('com_admin_search')}
                aria-label={localize('com_admin_search')}
              />
            </div>
          </div>

          <div className="border-border-light overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="text-text-secondary text-start text-xs">
                <tr className="border-border-light border-b">
                  <th scope="col" className="px-4 py-2 text-start font-medium">
                    {localize('com_admin_col_user')}
                  </th>
                  <th scope="col" className="px-4 py-2 text-start font-medium">
                    {localize('com_admin_col_pack')}
                  </th>
                  <th scope="col" className="px-4 py-2 text-start font-medium">
                    {localize('com_admin_col_usage')}
                  </th>
                  <th scope="col" className="px-4 py-2 text-end font-medium">
                    {localize('com_admin_col_balance')}
                  </th>
                  <th scope="col" className="px-4 py-2">
                    <span className="sr-only">{localize('com_admin_col_actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody aria-busy={users.isLoading}>
                {users.isLoading &&
                  Array.from({ length: 3 }, (_, index) => (
                    <tr key={index} className="border-border-light border-b last:border-0">
                      <td colSpan={5} className="px-4 py-3">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    </tr>
                  ))}
                {users.isError && (
                  <tr>
                    <td colSpan={5} className="text-text-destructive px-4 py-6 text-center">
                      <span role="alert">{localize('com_admin_load_error')}</span>
                    </td>
                  </tr>
                )}
                {users.data?.users.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-text-secondary px-4 py-6 text-center">
                      {localize('com_admin_no_users')}
                    </td>
                  </tr>
                )}
                {users.data?.users.map((row) => (
                  <tr key={row.id} className="border-border-light border-b last:border-0">
                    <td className="px-4 py-2">
                      <div className="text-text-primary font-medium">
                        {row.name || row.username}
                        {row.role === SystemRoles.ADMIN && (
                          <span className="text-text-secondary ms-2 text-xs">ADMIN</span>
                        )}
                      </div>
                      <div className="text-text-secondary text-xs">{row.email}</div>
                    </td>
                    <td className="text-text-secondary px-4 py-2">
                      {row.balance?.packLabel || '—'}
                    </td>
                    <td className="px-4 py-2">
                      <UsageCell user={row} />
                    </td>
                    <td className="text-text-primary px-4 py-2 text-end">
                      {formatUsd(row.balance?.tokenCredits ?? 0)}
                    </td>
                    <td className="px-4 py-2 text-end">
                      <Button size="compact" variant="outline" onClick={() => setGranting(row)}>
                        {localize('com_admin_grant')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {total > PAGE_SIZE && (
            <nav
              aria-label={localize('com_admin_pagination')}
              className="flex items-center justify-end gap-2 text-sm"
            >
              <span className="text-text-secondary">
                {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} / {total}
              </span>
              <Button
                size="compact"
                variant="outline"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(offset - PAGE_SIZE, 0))}
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
            </nav>
          )}
        </section>
      </div>

      {granting != null && (
        <GrantDialog
          user={granting}
          packs={packs.data?.packs ?? []}
          onClose={() => setGranting(null)}
        />
      )}
    </main>
  );
}
