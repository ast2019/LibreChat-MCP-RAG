import { useEffect, useState } from 'react';
import { UserPlus, Users as UsersIcon } from 'lucide-react';
import { SystemRoles } from 'librechat-data-provider';
import { Button, Input, Skeleton } from '@librechat/client';
import type { TAdminBillingUser } from 'librechat-data-provider';
import type { UserAction } from './UserActions';
import { useAdminBillingUsersQuery, useAdminBillingPacksQuery } from '~/data-provider';
import { useBalanceDisplay } from '~/hooks/useBalanceSummary';
import { useLocalize, useAuthContext } from '~/hooks';
import CreateUserDialog from './CreateUserDialog';
import { Money, UsageCell } from './parts';
import UserActions from './UserActions';
import ModelAccess from './ModelAccess';
import UserSwitch from './UserSwitch';
import GiftNote from './GiftNote';
import GrantDialog from './GrantDialog';
import UsageDialog from './UsageDialog';
import RoleDialog from './RoleDialog';
import { cn } from '~/utils';

const PAGE_SIZE = 25;
const SEARCH_DELAY_MS = 300;

/** Column widths shared by the header and every row on wide screens. */
const COL = {
  pack: 'md:w-28',
  usage: 'md:w-32',
  access: 'md:w-44',
  credit: 'md:w-32 md:text-end',
  actions: 'md:w-10',
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat(document.documentElement.lang || undefined).format(value);
}

/** The cell's name above its value on small screens, where rows become cards; read by screen
 *  readers on wide screens, where the visible header row carries it. */
function CellLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-text-secondary block text-xs md:sr-only">{children}</span>;
}

function UserCell({ row }: { row: TAdminBillingUser }) {
  const localize = useLocalize();
  const name = row.name || row.username || row.email || row.phone || '—';
  const initial = name.trim().charAt(0).toUpperCase();
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 pe-10 md:pe-0">
      <span
        aria-hidden="true"
        className="bg-surface-tertiary text-text-secondary flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
      >
        {initial}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-text-primary truncate text-sm font-medium" title={name} dir="auto">
            {name}
          </span>
          {row.role === SystemRoles.ADMIN && (
            <span className="text-text-secondary border-border-light shrink-0 rounded-md border px-1.5 text-xs">
              {localize('com_ui_admin')}
            </span>
          )}
        </div>
        {row.email && (
          <div className="text-text-secondary truncate text-xs" dir="ltr" title={row.email}>
            <bdi>{row.email}</bdi>
          </div>
        )}
        {row.phone && (
          <div className="text-text-secondary truncate text-xs" dir="ltr">
            <bdi>{row.phone}</bdi>
          </div>
        )}
      </div>
    </div>
  );
}

function RowSkeleton() {
  return (
    <li className="border-border-light flex items-center gap-3 border-b px-4 py-3 last:border-0">
      <Skeleton className="size-9 shrink-0 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </li>
  );
}

/** Every user with their pack, usage, model access and credit. Each row's actions (usage, add
 *  credit, admin role) sit behind one menu; on narrow screens rows become cards. */
export default function Users() {
  const localize = useLocalize();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [granting, setGranting] = useState<TAdminBillingUser | null>(null);
  const [viewingUsage, setViewingUsage] = useState<TAdminBillingUser | null>(null);
  const [changingRole, setChangingRole] = useState<TAdminBillingUser | null>(null);
  const [creating, setCreating] = useState(false);
  const { user: currentUser } = useAuthContext();
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
  const rows = users.data?.users ?? [];

  const onAction = (action: UserAction, row: TAdminBillingUser) => {
    if (action === 'usage') {
      setViewingUsage(row);
    } else if (action === 'grant') {
      setGranting(row);
    } else {
      setChangingRole(row);
    }
  };

  return (
    <>
      <section aria-labelledby="admin-users" className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2
            id="admin-users"
            className="text-text-primary flex items-center gap-2 text-base font-semibold"
          >
            {localize('com_admin_user_list')}
            {users.data != null && (
              <span className="bg-surface-tertiary text-text-secondary rounded-full px-2 text-xs font-medium">
                {formatNumber(total)}
              </span>
            )}
          </h2>
          <div className="order-last w-full sm:order-none sm:ms-auto sm:w-72">
            <Input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={localize('com_admin_search')}
              aria-label={localize('com_admin_search')}
            />
          </div>
          <Button
            onClick={() => setCreating(true)}
            data-testid="admin-create-user"
            className="ms-auto sm:ms-0"
          >
            <UserPlus className="size-4" aria-hidden="true" />
            <span className="ms-2">{localize('com_admin_create_user')}</span>
          </Button>
        </div>

        <GiftNote />

        <div className="border-border-light overflow-hidden rounded-xl border">
          <div
            aria-hidden="true"
            className="bg-surface-secondary border-border-light text-text-secondary hidden items-center gap-4 border-b px-4 py-2 text-xs font-medium md:flex"
          >
            <span className="flex-1">{localize('com_admin_col_user')}</span>
            <span className={COL.pack}>{localize('com_admin_col_pack')}</span>
            <span className={COL.usage}>{localize('com_admin_col_usage')}</span>
            <span className={COL.access}>{localize('com_admin_col_model_access')}</span>
            <span className={COL.credit}>{localize('com_admin_col_balance')}</span>
            <span className={COL.actions} />
          </div>

          {users.isError && (
            <p role="alert" className="text-text-destructive px-4 py-8 text-center text-sm">
              {localize('com_admin_load_error')}
            </p>
          )}
          {!users.isError && users.data != null && rows.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <UsersIcon className="text-text-tertiary size-8" aria-hidden="true" />
              <p className="text-text-secondary text-sm">{localize('com_admin_no_users')}</p>
            </div>
          )}

          <ul
            aria-labelledby="admin-users"
            aria-busy={users.isLoading || users.isFetching}
            className={users.isFetching && !users.isLoading ? 'opacity-60' : undefined}
          >
            {users.isLoading && Array.from({ length: 4 }, (_, i) => <RowSkeleton key={i} />)}
            {rows.map((row) => (
              <li
                key={row.id}
                data-testid="admin-user-row"
                className="border-border-light hover:bg-surface-hover relative flex flex-col gap-3 border-b px-4 py-3 last:border-0 md:flex-row md:items-center md:gap-4"
              >
                <UserCell row={row} />
                <div className="grid grid-cols-2 gap-3 md:contents">
                  <div className={cn('order-1 min-w-0 text-sm md:order-none', COL.pack)}>
                    <CellLabel>{localize('com_admin_col_pack')}</CellLabel>
                    <span
                      className="text-text-secondary block truncate"
                      title={row.balance?.packLabel}
                    >
                      {row.balance?.packLabel || '—'}
                    </span>
                  </div>
                  <div className={cn('order-3 col-span-2 md:order-none', COL.usage)}>
                    <CellLabel>{localize('com_admin_col_usage')}</CellLabel>
                    <UsageCell user={row} />
                  </div>
                  <div className={cn('order-4 col-span-2 md:order-none', COL.access)}>
                    <CellLabel>{localize('com_admin_col_model_access')}</CellLabel>
                    <div className="flex flex-col gap-1">
                      <ModelAccess user={row} />
                      <UserSwitch user={row} field="apiAccess" />
                      <UserSwitch user={row} field="mediaAccess" />
                    </div>
                  </div>
                  <div
                    className={cn(
                      'text-text-primary order-2 text-sm whitespace-nowrap md:order-none',
                      COL.credit,
                    )}
                  >
                    <CellLabel>{localize('com_admin_col_balance')}</CellLabel>
                    <Money credits={row.balance?.tokenCredits ?? 0} currency={currency} />
                  </div>
                </div>
                <div className={cn('absolute inset-e-3 top-3 md:static', COL.actions)}>
                  <UserActions user={row} isSelf={row.id === currentUser?.id} onAction={onAction} />
                </div>
              </li>
            ))}
          </ul>
        </div>

        {total > PAGE_SIZE && (
          <nav
            aria-label={localize('com_admin_pagination')}
            className="flex flex-wrap items-center justify-between gap-2 text-sm"
          >
            <span className="text-text-secondary">
              {localize('com_admin_pagination_range', {
                0: formatNumber(offset + 1),
                1: formatNumber(Math.min(offset + PAGE_SIZE, total)),
                2: formatNumber(total),
              })}
            </span>
            <span className="flex gap-2">
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
            </span>
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
      {changingRole != null && (
        <RoleDialog user={changingRole} onClose={() => setChangingRole(null)} />
      )}
      {creating && <CreateUserDialog open onClose={() => setCreating(false)} />}
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
