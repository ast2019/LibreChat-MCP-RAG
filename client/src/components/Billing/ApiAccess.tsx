import { Dropdown, useToastContext } from '@librechat/client';
import type { TAdminBillingUser } from 'librechat-data-provider';
import { useAdminUserApiAccessMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

type Choice = 'role' | 'allow' | 'deny';

function toChoice(value?: boolean): Choice {
  if (value === true) {
    return 'allow';
  }
  return value === false ? 'deny' : 'role';
}

/** One user's programming API switch: follow the role, always allow, or never allow. */
export default function ApiAccess({ user }: { user: TAdminBillingUser }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const update = useAdminUserApiAccessMutation();
  const userName = user.name || user.username || user.email;
  const label = localize('com_admin_api_access');

  const change = (choice: Choice) => {
    if (choice === toChoice(user.apiAccess)) {
      return;
    }
    update.mutate(
      { userId: user.id, apiAccess: choice === 'role' ? null : choice === 'allow' },
      {
        onSuccess: () => showToast({ status: 'success', message: localize('com_admin_saved') }),
        onError: () => showToast({ status: 'error', message: localize('com_admin_save_error') }),
      },
    );
  };

  return (
    <div className="flex items-center justify-between gap-1.5">
      <span className="text-text-secondary truncate text-xs" aria-hidden="true">
        {label}
      </span>
      <Dropdown
        variant="compact"
        value={toChoice(user.apiAccess)}
        options={[
          { value: 'role', label: localize('com_admin_model_access_role') },
          { value: 'allow', label: localize('com_admin_model_access_allow') },
          { value: 'deny', label: localize('com_admin_model_access_deny') },
        ]}
        onChange={(value) => change(value as Choice)}
        ariaLabel={`${label}: ${userName}`}
        testId={`api-access-${user.id}`}
        sizeClasses="z-50"
      />
    </div>
  );
}
