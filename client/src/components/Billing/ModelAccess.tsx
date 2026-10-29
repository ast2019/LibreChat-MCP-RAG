import { useState } from 'react';
import { SystemRoles } from 'librechat-data-provider';
import { Dropdown, useToastContext } from '@librechat/client';
import type { TAdminBillingUser, TUserModelAccess } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks/useLocalize';
import { useAdminUserModelAccessMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

type AccessKey = keyof TUserModelAccess;
type Choice = 'role' | 'allow' | 'deny';

const CLASSES: { key: AccessKey; label: TranslationKeys }[] = [
  { key: 'local', label: 'com_admin_model_access_local' },
  { key: 'private', label: 'com_admin_model_access_private' },
];

const CHOICES: { value: Choice; label: TranslationKeys }[] = [
  { value: 'role', label: 'com_admin_model_access_role' },
  { value: 'allow', label: 'com_admin_model_access_allow' },
  { value: 'deny', label: 'com_admin_model_access_deny' },
];

function toChoice(value?: boolean): Choice {
  if (value === true) {
    return 'allow';
  }
  return value === false ? 'deny' : 'role';
}

function fromChoice(choice: Choice): boolean | null {
  if (choice === 'allow') {
    return true;
  }
  return choice === 'deny' ? false : null;
}

/**
 * One user's override of the local and private model classes: follow the role, always allow, or
 * never allow. Admins always have both, so their row explains that instead of offering a choice.
 */
export default function ModelAccess({ user }: { user: TAdminBillingUser }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const update = useAdminUserModelAccessMutation();
  const [failed, setFailed] = useState(false);
  const userName = user.name || user.username || user.email;

  if (user.role === SystemRoles.ADMIN) {
    return (
      <span className="text-text-secondary text-xs">
        {localize('com_admin_model_access_admin')}
      </span>
    );
  }

  const options = CHOICES.map((choice) => ({
    value: choice.value,
    label: localize(choice.label),
  }));

  const change = (key: AccessKey, choice: Choice) => {
    if (choice === toChoice(user.modelAccess?.[key])) {
      return;
    }
    setFailed(false);
    update.mutate(
      { userId: user.id, [key]: fromChoice(choice) },
      {
        onSuccess: () => showToast({ status: 'success', message: localize('com_admin_saved') }),
        onError: () => {
          setFailed(true);
          showToast({ status: 'error', message: localize('com_admin_save_error') });
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 md:flex-col md:items-stretch">
        {CLASSES.map(({ key, label }) => (
          <div key={key} className="flex items-center justify-between gap-1.5">
            <span className="text-text-secondary truncate text-xs" aria-hidden="true">
              {localize(label)}
            </span>
            <Dropdown
              variant="compact"
              value={toChoice(user.modelAccess?.[key])}
              options={options}
              onChange={(value) => change(key, value as Choice)}
              ariaLabel={`${localize(label)}: ${userName}`}
              testId={`model-access-${key}-${user.id}`}
              sizeClasses="z-50"
            />
          </div>
        ))}
      </div>
      {failed && (
        <span role="alert" className="text-text-destructive text-xs">
          {localize('com_admin_save_error')}
        </span>
      )}
    </div>
  );
}
