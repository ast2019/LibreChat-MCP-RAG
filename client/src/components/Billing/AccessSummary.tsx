import { Check, Minus } from 'lucide-react';
import { ACCESS_CLASSES } from 'librechat-data-provider';
import type { TAdminBillingUser } from 'librechat-data-provider';
import { ACCESS_LABELS, overrideOf } from './accessLabels';
import { formatCount } from './format';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/**
 * The table's read-only view of a user's access: one chip per class, on or off as it resolves
 * now. A class the user has their own setting for gets a stronger edge and says so to screen
 * readers; changing anything happens in the user's sheet.
 */
export default function AccessSummary({ user }: { user: TAdminBillingUser }) {
  const localize = useLocalize();
  const custom = ACCESS_CLASSES.filter((field) => typeof overrideOf(user, field) === 'boolean');

  return (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-wrap gap-1" data-testid={`access-summary-${user.id}`}>
        {ACCESS_CLASSES.map((field) => {
          const allowed = user.effective?.[field]?.allowed;
          const isCustom = custom.includes(field);
          const state =
            allowed == null
              ? ''
              : localize(allowed ? 'com_admin_model_access_allow' : 'com_admin_model_access_deny');
          const title = [
            localize(ACCESS_LABELS[field].full),
            state,
            isCustom ? localize('com_admin_access_custom') : '',
          ]
            .filter(Boolean)
            .join(' · ');
          const Icon = allowed ? Check : Minus;
          return (
            <li
              key={field}
              title={title}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs',
                isCustom ? 'border-border-heavy' : 'border-border-light',
                allowed ? 'text-text-primary' : 'text-text-tertiary',
              )}
            >
              {allowed != null && <Icon className="size-3" aria-hidden="true" />}
              <span aria-hidden="true">{localize(ACCESS_LABELS[field].short)}</span>
              <span className="sr-only">{title}</span>
            </li>
          );
        })}
      </ul>
      {custom.length > 0 && (
        <span className="text-text-secondary text-xs">
          {localize('com_admin_access_custom_count', { 0: formatCount(custom.length) })}
        </span>
      )}
    </div>
  );
}
