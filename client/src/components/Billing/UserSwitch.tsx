import { Dropdown, useToastContext } from '@librechat/client';
import type { TAdminBillingUser } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks/useLocalize';
import { useAdminUserApiAccessMutation, useAdminUserMediaAccessMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

type Choice = 'default' | 'allow' | 'deny';
type Field = 'apiAccess' | 'mediaAccess';

const LABELS: Record<Field, { label: TranslationKeys; follow: TranslationKeys }> = {
  apiAccess: { label: 'com_admin_api_access', follow: 'com_admin_model_access_role' },
  mediaAccess: { label: 'com_admin_media_access', follow: 'com_admin_media_access_default' },
};

function toChoice(value?: boolean): Choice {
  if (value === true) {
    return 'allow';
  }
  return value === false ? 'deny' : 'default';
}

/** One user's switch for a feature: follow the default rule, always allow, or never allow. */
export default function UserSwitch({ user, field }: { user: TAdminBillingUser; field: Field }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const api = useAdminUserApiAccessMutation();
  const media = useAdminUserMediaAccessMutation();
  const userName = user.name || user.username || user.email;
  const label = localize(LABELS[field].label);

  const change = (choice: Choice) => {
    if (choice === toChoice(user[field])) {
      return;
    }
    const value = choice === 'default' ? null : choice === 'allow';
    const options = {
      onSuccess: () => showToast({ status: 'success', message: localize('com_admin_saved') }),
      onError: () => showToast({ status: 'error', message: localize('com_admin_save_error') }),
    };
    if (field === 'apiAccess') {
      api.mutate({ userId: user.id, apiAccess: value }, options);
    } else {
      media.mutate({ userId: user.id, mediaAccess: value }, options);
    }
  };

  return (
    <div className="flex items-center justify-between gap-1.5">
      <span className="text-text-secondary truncate text-xs" aria-hidden="true">
        {label}
      </span>
      <Dropdown
        variant="compact"
        value={toChoice(user[field])}
        options={[
          { value: 'default', label: localize(LABELS[field].follow) },
          { value: 'allow', label: localize('com_admin_model_access_allow') },
          { value: 'deny', label: localize('com_admin_model_access_deny') },
        ]}
        onChange={(value) => change(value as Choice)}
        ariaLabel={`${label}: ${userName}`}
        testId={`${field === 'apiAccess' ? 'api' : 'media'}-access-${user.id}`}
        sizeClasses="z-50"
      />
    </div>
  );
}
