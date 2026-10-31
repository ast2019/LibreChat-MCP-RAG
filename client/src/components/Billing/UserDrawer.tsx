import { ChartPie, ShieldCheck, ShieldOff, WalletCards } from 'lucide-react';
import { ACCESS_CLASSES, SystemRoles } from 'librechat-data-provider';
import { Button, OGDialog, OGDialogContent, OGDialogTitle } from '@librechat/client';
import type { TAdminBillingPack, TAdminBillingUser } from 'librechat-data-provider';
import type { CurrencyConfig } from '~/utils';
import type { UserAction } from './UserActions';
import { Money, UsageCell } from './parts';
import AccessControl from './AccessControl';
import { useLocalize } from '~/hooks';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-border-light border-t pt-4">
      <h3 className="text-text-primary mb-2 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Everything about one user in a side sheet: who they are, their pack and credit, each access
 * class with what it resolves to now, and their role. The list stays light; this is where an
 * admin changes things for one person.
 */
export default function UserDrawer({
  user,
  packs,
  currency,
  isSelf,
  onAction,
  onClose,
}: {
  user: TAdminBillingUser | null;
  packs: readonly TAdminBillingPack[];
  currency?: CurrencyConfig;
  /** The signed-in admin's own row: their role cannot be changed from here. */
  isSelf: boolean;
  onAction: (action: UserAction, user: TAdminBillingUser) => void;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const name = user ? user.name || user.username || user.email || user.phone || '—' : '';
  const isAdmin = user?.role === SystemRoles.ADMIN;

  return (
    <OGDialog open={user != null} onOpenChange={(open) => !open && onClose()}>
      <OGDialogContent
        bare
        className="fixed inset-y-0 end-0 w-full max-w-md"
        data-testid="admin-user-drawer"
      >
        {user && (
          <div className="bg-surface-dialog border-border-light high-contrast:border-border-medium flex h-full flex-col gap-4 overflow-y-auto border-s px-5 py-6 shadow-lg">
            <div className="pe-8">
              <OGDialogTitle className="text-lg font-semibold" dir="auto">
                {name}
              </OGDialogTitle>
              <p className="text-text-secondary mt-1 text-xs">
                {isAdmin ? localize('com_admin_role_admin') : localize('com_admin_role_user')}
              </p>
              {user.email && (
                <p className="text-text-secondary truncate text-sm" dir="ltr">
                  <bdi>{user.email}</bdi>
                </p>
              )}
              {user.phone && (
                <p className="text-text-secondary text-sm" dir="ltr">
                  <bdi>{user.phone}</bdi>
                </p>
              )}
            </div>

            <Section title={localize('com_admin_drawer_pack')}>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-text-secondary text-xs">{localize('com_admin_col_pack')}</dt>
                  <dd className="text-text-primary truncate">
                    {user.balance?.packLabel || localize('com_admin_no_pack')}
                  </dd>
                </div>
                <div>
                  <dt className="text-text-secondary text-xs">
                    {localize('com_admin_col_balance')}
                  </dt>
                  <dd className="text-text-primary">
                    <Money credits={user.balance?.tokenCredits ?? 0} currency={currency} />
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-text-secondary text-xs">{localize('com_admin_col_usage')}</dt>
                  <dd>
                    <UsageCell user={user} />
                  </dd>
                </div>
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="compact" variant="outline" onClick={() => onAction('grant', user)}>
                  <WalletCards className="me-1.5 size-4" aria-hidden="true" />
                  {localize('com_admin_grant')}
                </Button>
                <Button size="compact" variant="outline" onClick={() => onAction('usage', user)}>
                  <ChartPie className="me-1.5 size-4" aria-hidden="true" />
                  {localize('com_admin_spend_button')}
                </Button>
              </div>
            </Section>

            <Section title={localize('com_admin_drawer_access')}>
              <p className="text-text-secondary mb-1 text-xs">
                {localize('com_admin_drawer_access_hint')}
              </p>
              <div className="divide-border-light divide-y">
                {ACCESS_CLASSES.map((field) => (
                  <AccessControl key={field} user={user} field={field} packs={packs} />
                ))}
                {isAdmin && (
                  <div className="flex items-center justify-between gap-3 py-2">
                    <span className="text-text-primary text-sm">
                      {localize('com_admin_access_special')}
                    </span>
                    <span className="text-text-secondary text-xs">
                      {localize('com_admin_access_special_hint')}
                    </span>
                  </div>
                )}
              </div>
            </Section>

            <Section title={localize('com_admin_drawer_role')}>
              <Button
                size="compact"
                variant="outline"
                disabled={isSelf}
                onClick={() => onAction('role', user)}
              >
                {isAdmin ? (
                  <ShieldOff className="me-1.5 size-4" aria-hidden="true" />
                ) : (
                  <ShieldCheck className="me-1.5 size-4" aria-hidden="true" />
                )}
                {isSelf
                  ? localize('com_admin_role_self')
                  : localize(isAdmin ? 'com_admin_role_demote' : 'com_admin_role_promote')}
              </Button>
            </Section>
          </div>
        )}
      </OGDialogContent>
    </OGDialog>
  );
}
