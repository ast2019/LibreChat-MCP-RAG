import { useEffect, useId, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RotateCcw, ShieldCheck, UserPlus, Users as UsersIcon, WalletCards, X } from 'lucide-react';
import { SystemRoles } from 'librechat-data-provider';
import { Button, Checkbox, Dropdown, Input, Skeleton } from '@librechat/client';
import type {
  TAdminBillingUser,
  TAdminBillingUserSort,
  TAdminBillingAccessFilter,
  TAdminBillingBalanceFilter,
  TAdminBillingUserRoleFilter,
} from 'librechat-data-provider';
import type { UserAction } from './UserActions';
import { useAdminBillingUsersQuery, useAdminBillingPacksQuery } from '~/data-provider';
import { useBalanceDisplay } from '~/hooks/useBalanceSummary';
import { useLocalize, useAuthContext } from '~/hooks';
import CreateUserDialog from './CreateUserDialog';
import { Money, UsageCell } from './parts';
import UserActions from './UserActions';
import BulkAccessDialog from './BulkAccessDialog';
import AccessSummary from './AccessSummary';
import UserDrawer from './UserDrawer';
import GiftNote from './GiftNote';
import GrantDialog from './GrantDialog';
import UsageDialog from './UsageDialog';
import RoleDialog from './RoleDialog';
import { cn } from '~/utils';

const PAGE_SIZE = 25;
const SEARCH_DELAY_MS = 300;
const ALL = 'all';
const PACK_PREFIX = 'pack:';

type AllFilter = typeof ALL;
type RoleFilter = TAdminBillingUserRoleFilter | AllFilter;
type BalanceFilter = TAdminBillingBalanceFilter | AllFilter;
type AccessFilter = TAdminBillingAccessFilter | AllFilter;
type PackFilter = 'all' | 'has' | 'none' | `pack:${string}`;

/** Column widths shared by the header and every row on wide screens. */
const COL = {
  select: 'md:w-6',
  pack: 'md:w-28',
  usage: 'md:w-32',
  access: 'md:w-52',
  credit: 'md:w-32 md:text-end',
  actions: 'md:w-10',
};

const ROLE_FILTERS: readonly string[] = ['USER', 'ADMIN'];
const BALANCE_FILTERS: readonly string[] = ['positive', 'empty'];
const ACCESS_FILTERS: readonly string[] = ['custom', 'default'];
const SORTS: readonly string[] = ['newest', 'oldest', 'name'];

/** A URL value when it is one of `allowed`, else the default. */
function pick<T extends string>(value: string | null, allowed: readonly string[], fallback: T): T {
  return value != null && allowed.includes(value) ? (value as T) : fallback;
}

/**
 * The list's filters, sort and page, kept in the address (`?tab=users&q=…&pack=…&page=2`) so a
 * view can be shared, survives a reload and comes back with the browser's back button. Writing
 * merges into the current query, so `tab` and anything else there stay.
 */
function useUserFilters() {
  const [params, setParams] = useSearchParams();
  const pack = params.get('pack');
  const filters = {
    search: params.get('q') ?? '',
    role: pick<RoleFilter>(params.get('role'), ROLE_FILTERS, ALL),
    pack: (pack === 'has' || pack === 'none' || pack?.startsWith(PACK_PREFIX)
      ? pack
      : ALL) as PackFilter,
    balance: pick<BalanceFilter>(params.get('balance'), BALANCE_FILTERS, ALL),
    access: pick<AccessFilter>(params.get('access'), ACCESS_FILTERS, ALL),
    sort: pick<TAdminBillingUserSort>(params.get('sort'), SORTS, 'newest'),
    page: Math.max(Number.parseInt(params.get('page') ?? '1', 10) || 1, 1),
  };

  /** Sets the given keys (removing defaults and empties) and, unless `page` is set, page 1. */
  const update = (
    changes: Partial<
      Record<'q' | 'role' | 'pack' | 'balance' | 'access' | 'sort' | 'page', string>
    >,
  ) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(changes)) {
          const isDefault =
            value == null ||
            value === '' ||
            value === ALL ||
            (key === 'sort' && value === 'newest') ||
            (key === 'page' && value === '1');
          if (isDefault) {
            next.delete(key);
          } else {
            next.set(key, value);
          }
        }
        if (!('page' in changes)) {
          next.delete('page');
        }
        return next;
      },
      { replace: true },
    );
  };

  const reset = () => update({ q: '', role: ALL, pack: ALL, balance: ALL, access: ALL });

  return { filters, update, reset };
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(document.documentElement.lang || undefined).format(value);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(document.documentElement.lang || undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

/** The cell's name above its value on small screens, where rows become cards; read by screen
 *  readers on wide screens, where the visible header row carries it. */
function CellLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-text-secondary block text-xs md:sr-only">{children}</span>;
}

function FilterField({
  id,
  label,
  children,
  className,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <span id={id} className="text-text-secondary block text-xs font-medium">
        {label}
      </span>
      {children}
    </div>
  );
}

function UserCell({ row, onOpen }: { row: TAdminBillingUser; onOpen: () => void }) {
  const localize = useLocalize();
  const name = row.name || row.username || row.email || row.phone || '—';
  const initial = name.trim().charAt(0).toUpperCase();
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 pe-10 md:pe-0">
      <span
        aria-hidden="true"
        className="bg-surface-tertiary text-text-secondary flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
      >
        {initial}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onOpen}
            className="text-text-primary focus-visible:ring-text-primary truncate rounded-sm text-start text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
            title={localize('com_admin_open_details', { 0: name })}
            dir="auto"
          >
            {name}
          </button>
          <span className="text-text-secondary border-border-light shrink-0 rounded-md border px-1.5 py-0.5 text-xs">
            {row.role === SystemRoles.ADMIN
              ? localize('com_admin_role_admin')
              : localize('com_admin_role_user')}
          </span>
        </div>
        {row.email && (
          <div className="text-text-secondary truncate text-xs" dir="ltr" title={row.email}>
            <bdi>{row.email}</bdi>
          </div>
        )}
        <div className="text-text-tertiary flex flex-wrap items-center gap-x-2 text-xs">
          {row.phone && (
            <bdi dir="ltr" title={row.phone}>
              {row.phone}
            </bdi>
          )}
          {row.createdAt && (
            <span>
              {localize('com_admin_user_joined', {
                0: formatDate(row.createdAt),
              })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function RowSkeleton() {
  return (
    <li className="border-border-light flex items-center gap-3 border-b px-4 py-4 last:border-0">
      <Skeleton className="size-10 shrink-0 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </li>
  );
}

/** Searchable, server-filtered user management with credit, access and role actions. */
export default function Users() {
  const localize = useLocalize();
  const roleId = useId();
  const packId = useId();
  const balanceId = useId();
  const accessId = useId();
  const sortId = useId();
  const searchId = useId();
  const { filters, update, reset } = useUserFilters();
  const { search, role, pack, balance, access, sort } = filters;
  const offset = (filters.page - 1) * PAGE_SIZE;
  const [searchInput, setSearchInput] = useState(search);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [openUserId, setOpenUserId] = useState<string | null>(null);
  const [bulkGranting, setBulkGranting] = useState(false);
  const [bulkAccess, setBulkAccess] = useState(false);
  const [granting, setGranting] = useState<TAdminBillingUser | null>(null);
  const [viewingUsage, setViewingUsage] = useState<TAdminBillingUser | null>(null);
  const [changingRole, setChangingRole] = useState<TAdminBillingUser | null>(null);
  const [creating, setCreating] = useState(false);
  const { user: currentUser } = useAuthContext();
  const { currency } = useBalanceDisplay();

  /** The box follows the address when it changes from outside (back button, cleared filters) */
  useEffect(() => {
    setSearchInput((current) => (current.trim() === search ? current : search));
  }, [search]);

  useEffect(() => {
    const next = searchInput.trim();
    if (next === search) {
      return;
    }
    const timeout = window.setTimeout(() => update({ q: next }), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `update` is rebuilt every render
  }, [searchInput, search]);

  /** A selection is for the page in view; a new page or filter starts empty */
  const viewKey = `${search}|${role}|${pack}|${balance}|${access}|${sort}|${filters.page}`;
  useEffect(() => {
    setSelected(new Set());
  }, [viewKey]);

  const packs = useAdminBillingPacksQuery();
  const selectedPack = pack.startsWith(PACK_PREFIX) ? pack.slice(PACK_PREFIX.length) : pack;
  const users = useAdminBillingUsersQuery({
    search: search || undefined,
    role: role === ALL ? undefined : role,
    pack: pack === ALL ? undefined : selectedPack,
    balance: balance === ALL ? undefined : balance,
    access: access === ALL ? undefined : access,
    sort,
    limit: PAGE_SIZE,
    offset,
  });
  const total = users.data?.total ?? 0;
  const rows = useMemo(() => users.data?.users ?? [], [users.data]);
  const packList = packs.data?.packs ?? [];
  /** The open sheet reads the row from the latest list, so a change shows there at once */
  const openUser = rows.find((row) => row.id === openUserId) ?? null;
  const hasFilters =
    searchInput.trim() !== '' || role !== ALL || pack !== ALL || balance !== ALL || access !== ALL;
  const selectedIds = rows.filter((row) => selected.has(row.id)).map((row) => row.id);
  const allSelected = rows.length > 0 && selectedIds.length === rows.length;
  let pageSelection: boolean | 'indeterminate' = allSelected;
  if (!allSelected && selectedIds.length > 0) {
    pageSelection = 'indeterminate';
  }

  const resetFilters = () => {
    setSearchInput('');
    reset();
  };

  const toggleRow = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(rows.map((row) => row.id)) : new Set());
  };

  const clearSelection = () => setSelected(new Set());

  const onAction = (action: UserAction, row: TAdminBillingUser) => {
    if (action === 'details') {
      setOpenUserId(row.id);
    } else if (action === 'usage') {
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
        <div className="border-border-light bg-surface-secondary flex flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-center">
          <div className="bg-surface-tertiary flex size-11 shrink-0 items-center justify-center rounded-xl">
            <UsersIcon className="text-text-secondary size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="admin-users" className="text-text-primary text-lg font-semibold">
              {localize('com_admin_user_list')}
            </h2>
            <p className="text-text-secondary mt-1 text-sm">
              {localize('com_admin_users_description')}
            </p>
          </div>
          <Button onClick={() => setCreating(true)} data-testid="admin-create-user">
            <UserPlus className="size-4" aria-hidden="true" />
            <span className="ms-2">{localize('com_admin_create_user')}</span>
          </Button>
        </div>

        <GiftNote />

        <div className="border-border-light rounded-xl border p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <FilterField
              id={searchId}
              label={localize('com_admin_filter_search')}
              className="sm:col-span-2"
            >
              <Input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder={localize('com_admin_search')}
                aria-labelledby={searchId}
              />
            </FilterField>
            <FilterField id={roleId} label={localize('com_admin_filter_role')}>
              <Dropdown
                value={role}
                options={[
                  { value: ALL, label: localize('com_admin_filter_all_roles') },
                  { value: 'USER', label: localize('com_admin_role_user') },
                  { value: 'ADMIN', label: localize('com_admin_role_admin') },
                ]}
                onChange={(value) => update({ role: value as RoleFilter })}
                ariaLabel={localize('com_admin_filter_role')}
                testId="admin-filter-role"
                sizeClasses="z-50"
              />
            </FilterField>
            <FilterField id={packId} label={localize('com_admin_filter_pack')}>
              <Dropdown
                value={pack}
                options={[
                  { value: ALL, label: localize('com_admin_filter_all_packs') },
                  { value: 'has', label: localize('com_admin_filter_has_pack') },
                  { value: 'none', label: localize('com_admin_filter_no_pack') },
                  ...(packs.data?.packs ?? []).map((item) => ({
                    value: `${PACK_PREFIX}${item.id}`,
                    label: item.label,
                  })),
                ]}
                onChange={(value) => update({ pack: value as PackFilter })}
                ariaLabel={localize('com_admin_filter_pack')}
                testId="admin-filter-pack"
                sizeClasses="z-50"
              />
            </FilterField>
            <FilterField id={balanceId} label={localize('com_admin_filter_balance')}>
              <Dropdown
                value={balance}
                options={[
                  { value: ALL, label: localize('com_admin_filter_all_balances') },
                  { value: 'positive', label: localize('com_admin_filter_has_balance') },
                  { value: 'empty', label: localize('com_admin_filter_empty_balance') },
                ]}
                onChange={(value) => update({ balance: value as BalanceFilter })}
                ariaLabel={localize('com_admin_filter_balance')}
                testId="admin-filter-balance"
                sizeClasses="z-50"
              />
            </FilterField>
            <FilterField id={accessId} label={localize('com_admin_filter_access')}>
              <Dropdown
                value={access}
                options={[
                  { value: ALL, label: localize('com_admin_filter_all_access') },
                  { value: 'custom', label: localize('com_admin_filter_custom_access') },
                  { value: 'default', label: localize('com_admin_filter_default_access') },
                ]}
                onChange={(value) => update({ access: value as AccessFilter })}
                ariaLabel={localize('com_admin_filter_access')}
                testId="admin-filter-access"
                sizeClasses="z-50"
              />
            </FilterField>
          </div>
          <div className="border-border-light mt-4 flex flex-wrap items-end justify-between gap-3 border-t pt-3">
            <div className="flex items-end gap-3">
              <FilterField id={sortId} label={localize('com_admin_sort')}>
                <Dropdown
                  variant="compact"
                  value={sort}
                  options={[
                    { value: 'newest', label: localize('com_admin_sort_newest') },
                    { value: 'oldest', label: localize('com_admin_sort_oldest') },
                    { value: 'name', label: localize('com_admin_sort_name') },
                  ]}
                  onChange={(value) => update({ sort: value as TAdminBillingUserSort })}
                  ariaLabel={localize('com_admin_sort')}
                  testId="admin-user-sort"
                  sizeClasses="z-50"
                />
              </FilterField>
              {hasFilters && (
                <Button size="compact" variant="ghost" onClick={resetFilters}>
                  <RotateCcw className="me-1 size-3.5" aria-hidden="true" />
                  {localize('com_admin_clear_filters')}
                </Button>
              )}
            </div>
            {users.data != null && (
              <p className="text-text-secondary text-sm" aria-live="polite">
                {localize('com_admin_results_count', { 0: formatNumber(total) })}
                {users.isFetching && (
                  <span className="text-text-tertiary ms-2">
                    {localize('com_admin_refreshing')}
                  </span>
                )}
              </p>
            )}
          </div>
        </div>

        {rows.length > 0 && (
          <div
            className="border-border-light flex flex-wrap items-center gap-3 rounded-xl border px-4 py-2"
            data-testid="admin-bulk-bar"
          >
            <Checkbox
              checked={pageSelection}
              onCheckedChange={(checked) => toggleAll(checked === true)}
              aria-label={localize('com_admin_select_page')}
            />
            <span className="text-text-secondary text-sm" aria-live="polite">
              {selectedIds.length > 0
                ? localize('com_admin_bulk_selected', { 0: formatNumber(selectedIds.length) })
                : localize('com_admin_select_page')}
            </span>
            {selectedIds.length > 0 && (
              <span className="ms-auto flex flex-wrap gap-2">
                <Button size="compact" variant="outline" onClick={() => setBulkGranting(true)}>
                  <WalletCards className="me-1.5 size-4" aria-hidden="true" />
                  {localize('com_admin_bulk_grant')}
                </Button>
                <Button size="compact" variant="outline" onClick={() => setBulkAccess(true)}>
                  <ShieldCheck className="me-1.5 size-4" aria-hidden="true" />
                  {localize('com_admin_bulk_access')}
                </Button>
                <Button size="compact" variant="ghost" onClick={clearSelection}>
                  <X className="me-1 size-4" aria-hidden="true" />
                  {localize('com_admin_bulk_clear')}
                </Button>
              </span>
            )}
          </div>
        )}

        <div className="border-border-light overflow-hidden rounded-xl border">
          <div
            aria-hidden="true"
            className="bg-surface-secondary border-border-light text-text-secondary hidden items-center gap-4 border-b px-4 py-2.5 text-xs font-medium md:flex"
          >
            <span className={COL.select} />
            <span className="flex-1">{localize('com_admin_col_user')}</span>
            <span className={COL.pack}>{localize('com_admin_col_pack')}</span>
            <span className={COL.usage}>{localize('com_admin_col_usage')}</span>
            <span className={COL.access}>{localize('com_admin_col_model_access')}</span>
            <span className={COL.credit}>{localize('com_admin_col_balance')}</span>
            <span className={COL.actions} />
          </div>

          {users.isError && (
            <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
              <p role="alert" className="text-text-destructive text-sm">
                {localize('com_admin_users_load_error')}
              </p>
              <Button size="compact" variant="outline" onClick={() => users.refetch()}>
                {localize('com_ui_payment_retry')}
              </Button>
            </div>
          )}
          {!users.isError && users.data != null && rows.length === 0 && (
            <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
              <div className="bg-surface-secondary flex size-12 items-center justify-center rounded-full">
                <UsersIcon className="text-text-tertiary size-6" aria-hidden="true" />
              </div>
              <div>
                <p className="text-text-primary text-sm font-medium">
                  {hasFilters
                    ? localize('com_admin_no_filtered_users')
                    : localize('com_admin_no_users')}
                </p>
                {hasFilters && (
                  <p className="text-text-secondary mt-1 text-xs">
                    {localize('com_admin_no_filtered_users_hint')}
                  </p>
                )}
              </div>
              {hasFilters && (
                <Button size="compact" variant="outline" onClick={resetFilters}>
                  {localize('com_admin_clear_filters')}
                </Button>
              )}
            </div>
          )}

          <ul
            aria-labelledby="admin-users"
            aria-busy={users.isLoading || users.isFetching}
            className={cn(
              'transition-opacity',
              users.isFetching && !users.isLoading && 'opacity-60',
            )}
          >
            {users.isLoading && Array.from({ length: 4 }, (_, i) => <RowSkeleton key={i} />)}
            {rows.map((row) => (
              <li
                key={row.id}
                data-testid="admin-user-row"
                className="border-border-light hover:bg-surface-hover relative flex flex-col gap-3 border-b px-4 py-4 last:border-0 md:flex-row md:items-center md:gap-4"
              >
                <div className={cn('absolute inset-s-4 top-5 md:static', COL.select)}>
                  <Checkbox
                    checked={selected.has(row.id)}
                    onCheckedChange={(checked) => toggleRow(row.id, checked === true)}
                    aria-label={localize('com_admin_select_user', {
                      0: row.name || row.username || row.email || row.phone || '',
                    })}
                  />
                </div>
                <div className="ps-8 md:contents md:ps-0">
                  <UserCell row={row} onOpen={() => setOpenUserId(row.id)} />
                </div>
                <div className="grid grid-cols-2 gap-3 md:contents">
                  <div className={cn('order-1 min-w-0 text-sm md:order-none', COL.pack)}>
                    <CellLabel>{localize('com_admin_col_pack')}</CellLabel>
                    <span
                      className="text-text-secondary block truncate"
                      title={row.balance?.packLabel}
                    >
                      {row.balance?.packLabel || localize('com_admin_no_pack')}
                    </span>
                  </div>
                  <div className={cn('order-3 col-span-2 md:order-none', COL.usage)}>
                    <CellLabel>{localize('com_admin_col_usage')}</CellLabel>
                    <UsageCell user={row} />
                  </div>
                  <div className={cn('order-4 col-span-2 md:order-none', COL.access)}>
                    <CellLabel>{localize('com_admin_col_model_access')}</CellLabel>
                    <AccessSummary user={row} />
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
                <div className={cn('absolute inset-e-3 top-4 md:static', COL.actions)}>
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
                onClick={() => update({ page: String(filters.page - 1) })}
              >
                {localize('com_ui_prev')}
              </Button>
              <Button
                size="compact"
                variant="outline"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => update({ page: String(filters.page + 1) })}
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
      <UserDrawer
        user={openUser}
        packs={packList}
        currency={currency}
        isSelf={openUser?.id === currentUser?.id}
        onAction={onAction}
        onClose={() => setOpenUserId(null)}
      />
      {granting != null && (
        <GrantDialog
          user={granting}
          packs={packList}
          currency={currency}
          onClose={() => setGranting(null)}
        />
      )}
      {bulkGranting && selectedIds.length > 0 && (
        <GrantDialog
          user={null}
          userIds={selectedIds}
          packs={packList}
          currency={currency}
          onClose={() => setBulkGranting(false)}
          onDone={clearSelection}
        />
      )}
      {bulkAccess && selectedIds.length > 0 && (
        <BulkAccessDialog
          userIds={selectedIds}
          onClose={() => setBulkAccess(false)}
          onDone={clearSelection}
        />
      )}
    </>
  );
}
