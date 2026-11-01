import { useState } from 'react';
import { SystemRoles } from 'librechat-data-provider';
import { Dropdown, useToastContext } from '@librechat/client';
import type { TAccessClass, TAdminBillingPack, TAdminBillingUser } from 'librechat-data-provider';
import {
  useAdminUserApiAccessMutation,
  useAdminUserMediaAccessMutation,
  useAdminUserBrowserAccessMutation,
  useAdminUserModelAccessMutation,
} from '~/data-provider';
import { ACCESS_LABELS, decidingPack, describeSource, overrideOf } from './accessLabels';
import { useLocalize } from '~/hooks';

type Choice = 'default' | 'allow' | 'deny';

function toChoice(value?: boolean): Choice {
  if (value === true) {
    return 'allow';
  }
  return value === false ? 'deny' : 'default';
}

function fromChoice(choice: Choice): boolean | null {
  if (choice === 'allow') {
    return true;
  }
  return choice === 'deny' ? false : null;
}

/** The test id each class's control has always carried, kept for the admin page tests. */
const TEST_IDS: Record<TAccessClass, (id: string) => string> = {
  local: (id) => `model-access-local-${id}`,
  private: (id) => `model-access-private-${id}`,
  api: (id) => `api-access-${id}`,
  media: (id) => `media-access-${id}`,
  browser: (id) => `browser-access-${id}`,
};

/**
 * One access class for one user: default, on or off for this user alone. The default option
 * says what it means now («پیش‌فرض (الان روشن)»), and a line below names who decides it — the
 * user's own setting, the admin role, the pack, the role's permission or the deployment rule.
 */
export default function AccessControl({
  user,
  field,
  packs,
}: {
  user: TAdminBillingUser;
  field: TAccessClass;
  packs: readonly TAdminBillingPack[];
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const modelAccess = useAdminUserModelAccessMutation();
  const apiAccess = useAdminUserApiAccessMutation();
  const mediaAccess = useAdminUserMediaAccessMutation();
  const browserAccess = useAdminUserBrowserAccessMutation();
  const [failed, setFailed] = useState(false);
  const label = localize(ACCESS_LABELS[field].full);
  const userName = user.name || user.username || user.email || user.phone || '';
  const effective = user.effective?.[field];
  /* Admins always have these; a switch would suggest it could be turned off. */
  const alwaysForAdmin = field === 'local' || field === 'private' || field === 'browser';

  if (alwaysForAdmin && user.role === SystemRoles.ADMIN) {
    return (
      <div className="flex items-center justify-between gap-3 py-2">
        <span className="text-text-primary text-sm">{label}</span>
        <span className="text-text-secondary text-xs">
          {localize('com_admin_access_source_admin')}
        </span>
      </div>
    );
  }

  const stateWord = (allowed: boolean) =>
    localize(allowed ? 'com_admin_model_access_allow' : 'com_admin_model_access_deny');
  /** Without a server-computed value (older servers) the default reads plainly. */
  const defaultLabel =
    effective != null && effective.source !== 'user'
      ? localize('com_admin_access_default_now', { 0: stateWord(effective.allowed) })
      : localize('com_admin_model_access_role');

  const options: { value: Choice; label: string }[] = [
    { value: 'default', label: defaultLabel },
    { value: 'allow', label: localize('com_admin_model_access_allow') },
    { value: 'deny', label: localize('com_admin_model_access_deny') },
  ];

  const change = (choice: Choice) => {
    if (choice === toChoice(overrideOf(user, field))) {
      return;
    }
    setFailed(false);
    const value = fromChoice(choice);
    const options = {
      onSuccess: () => showToast({ status: 'success', message: localize('com_admin_saved') }),
      onError: () => {
        setFailed(true);
        showToast({ status: 'error', message: localize('com_admin_save_error') });
      },
    };
    if (field === 'api') {
      apiAccess.mutate({ userId: user.id, apiAccess: value }, options);
    } else if (field === 'media') {
      mediaAccess.mutate({ userId: user.id, mediaAccess: value }, options);
    } else if (field === 'browser') {
      browserAccess.mutate({ userId: user.id, browserAccess: value }, options);
    } else {
      modelAccess.mutate({ userId: user.id, [field]: value }, options);
    }
  };

  return (
    <div className="flex flex-col gap-1 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-text-primary text-sm">{label}</span>
        <Dropdown
          variant="compact"
          value={toChoice(overrideOf(user, field))}
          options={options}
          onChange={(value) => change(value as Choice)}
          ariaLabel={`${label}: ${userName}`}
          testId={TEST_IDS[field](user.id)}
          portal={false}
        />
      </div>
      {effective != null && (
        <p className="text-text-secondary text-xs">
          {localize('com_admin_access_now', {
            0: stateWord(effective.allowed),
            1: describeSource(localize, effective, decidingPack(user, field, packs)),
          })}
        </p>
      )}
      {failed && (
        <span role="alert" className="text-text-destructive text-xs">
          {localize('com_admin_save_error')}
        </span>
      )}
    </div>
  );
}
