import { useEffect, useState } from 'react';
import { SystemRoles } from 'librechat-data-provider';
import { Button, Input, Skeleton } from '@librechat/client';
import type { TAdminBillingUser } from 'librechat-data-provider';
import { useAdminBillingUsersQuery, useAdminBillingPacksQuery } from '~/data-provider';
import { useBalanceDisplay } from '~/hooks/useBalanceSummary';
import { Money, UsageCell } from './parts';
import ModelAccess from './ModelAccess';
import GrantDialog from './GrantDialog';
import UsageDialog from './UsageDialog';
import { useLocalize } from '~/hooks';

const PAGE_SIZE = 25;
const SEARCH_DELAY_MS = 300;
const COLUMN_COUNT = 6;

/** Every user with their pack, usage, model access and credit, and the dialog that adds credit. */
export default function Users() {
  const localize = useLocalize();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [granting, setGranting] = useState<TAdminBillingUser | null>(null);
  const [viewingUsage, setViewingUsage] = useState<TAdminBillingUser | null>(null);
  const { currency } = useBalanceDisplay();

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setOffset(0);
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  const users = useAdminBillingUsersQuery({
    search: search || undefined,
    limit: PAGE_SIZE,
    offset,
  });
  const packs = useAdminBillingPacksQuery();
  const total = users.data?.total ?? 0;

  return (
    <>
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
                <th scope="col" className="px-4 py-2 text-start font-medium">
                  {localize('com_admin_col_model_access')}
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
                    <td colSpan={COLUMN_COUNT} className="px-4 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  </tr>
                ))}
              {users.isError && (
                <tr>
                  <td
                    colSpan={COLUMN_COUNT}
                    className="text-text-destructive px-4 py-6 text-center"
                  >
                    <span role="alert">{localize('com_admin_load_error')}</span>
                  </td>
                </tr>
              )}
              {users.data?.users.length === 0 && (
                <tr>
                  <td colSpan={COLUMN_COUNT} className="text-text-secondary px-4 py-6 text-center">
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
                        <span className="text-text-secondary border-border-light ms-2 rounded-md border px-1.5 py-0.5 text-xs font-normal">
                          {localize('com_ui_admin')}
                        </span>
                      )}
                    </div>
                    {row.email && <div className="text-text-secondary text-xs">{row.email}</div>}
                    {row.phone && (
                      <div className="text-text-secondary text-xs" dir="ltr">
                        <bdi>{row.phone}</bdi>
                      </div>
                    )}
                  </td>
                  <td className="text-text-secondary px-4 py-2">{row.balance?.packLabel || '—'}</td>
                  <td className="px-4 py-2">
                    <UsageCell user={row} />
                  </td>
                  <td className="px-4 py-2">
                    <ModelAccess user={row} />
                  </td>
                  <td className="text-text-primary px-4 py-2 text-end">
                    <Money credits={row.balance?.tokenCredits ?? 0} currency={currency} />
                  </td>
                  <td className="px-4 py-2 text-end">
                    <span className="inline-flex gap-2">
                      <Button
                        size="compact"
                        variant="outline"
                        onClick={() => setViewingUsage(row)}
                        data-testid="admin-user-usage"
                      >
                        {localize('com_admin_spend_button')}
                      </Button>
                      <Button size="compact" variant="outline" onClick={() => setGranting(row)}>
                        {localize('com_admin_grant')}
                      </Button>
                    </span>
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
      {viewingUsage != null && (
        <UsageDialog
          user={viewingUsage}
          currency={currency}
          onClose={() => setViewingUsage(null)}
        />
      )}
      {granting != null && (
        <GrantDialog
          user={granting}
          packs={packs.data?.packs ?? []}
          currency={currency}
          onClose={() => setGranting(null)}
        />
      )}
    </>
  );
}
