import { ACCESS_CLASSES, SystemRoles } from 'librechat-data-provider';
import type { TAdminBillingUser } from 'librechat-data-provider';
import { ACCESS_LABELS, overrideOf } from './accessLabels';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const chipClass = (strong: boolean) =>
  cn(
    'text-text-primary rounded-md border px-1.5 py-0.5 text-xs',
    strong ? 'border-border-heavy' : 'border-border-light',
  );

/**
 * The table's read-only view of a user's access: one chip for each class the user has now,
 * nothing for the ones they do not. A chip the user's own setting turned on has a stronger edge;
 * changing anything happens in the user's sheet. Admins also get «لوکال امن خاص», the admin-only
 * local models (`adminOnly` specs) no other role sees.
 */
export default function AccessSummary({ user }: { user: TAdminBillingUser }) {
  const localize = useLocalize();
  const allowed = ACCESS_CLASSES.filter((field) => user.effective?.[field]?.allowed === true);
  const isAdmin = user.role === SystemRoles.ADMIN;

  if (allowed.length === 0 && !isAdmin) {
    return (
      <span className="sr-only" data-testid={`access-summary-${user.id}`}>
        {localize('com_admin_access_none')}
      </span>
    );
  }

  return (
    <ul className="flex flex-wrap gap-1" data-testid={`access-summary-${user.id}`}>
      {allowed.map((field) => {
        const isCustom = typeof overrideOf(user, field) === 'boolean';
        const title = [
          localize(ACCESS_LABELS[field].full),
          isCustom ? localize('com_admin_access_custom') : '',
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <li key={field} title={title} className={chipClass(isCustom)}>
            <span aria-hidden="true">{localize(ACCESS_LABELS[field].short)}</span>
            <span className="sr-only">{title}</span>
          </li>
        );
      })}
      {isAdmin && (
        <li title={localize('com_admin_access_special')} className={chipClass(false)}>
          <span aria-hidden="true">{localize('com_admin_access_short_special')}</span>
          <span className="sr-only">{localize('com_admin_access_special')}</span>
        </li>
      )}
    </ul>
  );
}
