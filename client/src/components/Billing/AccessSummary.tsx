import { ACCESS_CLASSES } from 'librechat-data-provider';
import type { TAdminBillingUser } from 'librechat-data-provider';
import { ACCESS_LABELS, overrideOf } from './accessLabels';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/**
 * The table's read-only view of a user's access: one chip for each class the user has now,
 * nothing for the ones they do not. A chip the user's own setting turned on has a stronger edge;
 * changing anything happens in the user's sheet.
 */
export default function AccessSummary({ user }: { user: TAdminBillingUser }) {
  const localize = useLocalize();
  const allowed = ACCESS_CLASSES.filter((field) => user.effective?.[field]?.allowed === true);

  if (allowed.length === 0) {
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
          <li
            key={field}
            title={title}
            className={cn(
              'text-text-primary rounded-md border px-1.5 py-0.5 text-xs',
              isCustom ? 'border-border-heavy' : 'border-border-light',
            )}
          >
            <span aria-hidden="true">{localize(ACCESS_LABELS[field].short)}</span>
            <span className="sr-only">{title}</span>
          </li>
        );
      })}
    </ul>
  );
}
