import { useState } from 'react';
import { SystemRoles } from 'librechat-data-provider';
import { Button, Spinner, OGDialog, OGDialogTemplate, useToastContext } from '@librechat/client';
import type { TAdminBillingUser, TAdminSetUserRoleRequest } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { useAdminSetUserRoleMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

function serverMessageOf(error: unknown): string | undefined {
  const message = (error as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
  return typeof message === 'string' ? message : undefined;
}

const ROLE_OPTIONS: {
  value: TAdminSetUserRoleRequest['role'];
  label: TranslationKeys;
  hint: TranslationKeys;
}[] = [
  {
    value: SystemRoles.USER,
    label: 'com_admin_role_user',
    hint: 'com_admin_role_user_hint',
  },
  {
    value: SystemRoles.OPERATOR,
    label: 'com_admin_role_operator',
    hint: 'com_admin_role_operator_hint',
  },
  {
    value: SystemRoles.ADMIN,
    label: 'com_admin_role_admin',
    hint: 'com_admin_role_admin_hint',
  },
];

/** Sets a user's system grade: regular user, operator, or admin. */
export default function RoleDialog({
  user,
  onClose,
}: {
  user: TAdminBillingUser;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const setRole = useAdminSetUserRoleMutation();
  const current =
    user.role === SystemRoles.ADMIN || user.role === SystemRoles.OPERATOR
      ? user.role
      : SystemRoles.USER;
  const [role, setRoleChoice] = useState<TAdminSetUserRoleRequest['role']>(current);
  const who = user.name || user.username || user.email || user.phone || '';
  const unchanged = role === current;

  const submit = () => {
    if (unchanged) {
      onClose();
      return;
    }
    setRole.mutate(
      { userId: user.id, role },
      {
        onSuccess: () => {
          const roleLabel = localize(
            role === SystemRoles.ADMIN
              ? 'com_admin_role_admin'
              : role === SystemRoles.OPERATOR
                ? 'com_admin_role_operator'
                : 'com_admin_role_user',
          );
          showToast({
            status: 'success',
            message: localize('com_admin_role_changed', { 0: who, 1: roleLabel }),
          });
          onClose();
        },
        onError: (error) => {
          const lastAdmin = serverMessageOf(error)?.includes('last admin') === true;
          showToast({
            status: 'error',
            message: localize(
              lastAdmin ? 'com_admin_role_error_last_admin' : 'com_admin_role_error',
            ),
          });
        },
      },
    );
  };

  return (
    <OGDialog open onOpenChange={(open) => !open && onClose()}>
      <OGDialogTemplate
        title={localize('com_admin_role_change_title')}
        className="w-11/12 md:max-w-md"
        showCloseButton={false}
        main={
          <div className="space-y-3">
            <p className="text-text-secondary text-sm">
              {localize('com_admin_role_change_body', { 0: who })}
            </p>
            <div className="space-y-2" role="radiogroup" aria-label={localize('com_admin_role_change_title')}>
              {ROLE_OPTIONS.map((option) => {
                const selected = role === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setRoleChoice(option.value)}
                    className={cn(
                      'border-border-light w-full rounded-lg border px-3 py-2 text-start transition-colors',
                      selected
                        ? 'bg-surface-secondary border-border-medium'
                        : 'hover:bg-surface-tertiary',
                    )}
                  >
                    <span className="text-text-primary block text-sm font-medium">
                      {localize(option.label)}
                    </span>
                    <span className="text-text-secondary text-xs">{localize(option.hint)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        }
        buttons={
          <Button
            onClick={submit}
            disabled={setRole.isLoading || unchanged}
            aria-busy={setRole.isLoading}
          >
            {setRole.isLoading ? (
              <Spinner className="size-4" />
            ) : (
              localize('com_admin_role_save')
            )}
          </Button>
        }
      />
    </OGDialog>
  );
}
