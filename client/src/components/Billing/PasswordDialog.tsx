import { useId, useState } from 'react';
import {
  Button,
  Label,
  Spinner,
  OGDialog,
  SecretInput,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import type { TAdminBillingUser } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { useAdminSetUserPasswordMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

const ERROR_KEYS: Record<string, TranslationKeys> = {
  invalid_password: 'com_admin_password_invalid',
  admin_target_forbidden: 'com_admin_password_admin_forbidden',
  user_not_found: 'com_admin_password_user_missing',
};

function errorCodeOf(error: unknown): string | undefined {
  const data = (error as { response?: { data?: { error?: { code?: unknown } } } })?.response?.data;
  return typeof data?.error?.code === 'string' ? data.error.code : undefined;
}

/**
 * Sets a new password for one user, for when they cannot recover it themselves. The admin
 * types it twice; the user's signed-in sessions end, and the admin passes the password on.
 */
export default function PasswordDialog({
  user,
  onClose,
  minLength = 8,
}: {
  user: TAdminBillingUser;
  onClose: () => void;
  minLength?: number;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const setPassword = useAdminSetUserPasswordMutation();
  const passwordId = useId();
  const confirmId = useId();
  const [password, setPasswordValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const who = user.name || user.username || user.email || user.phone || '';
  const tooShort = password.length > 0 && password.length < minLength;
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = password.length >= minLength && password.trim() !== '' && confirm === password;

  const submit = () => {
    if (!ready) {
      return;
    }
    setPassword.mutate(
      { userId: user.id, password },
      {
        onSuccess: () => {
          showToast({
            status: 'success',
            message: localize('com_admin_password_saved', { 0: who }),
          });
          onClose();
        },
        onError: (error) => {
          const key = ERROR_KEYS[errorCodeOf(error) ?? ''] ?? 'com_admin_save_error';
          showToast({ status: 'error', message: localize(key, { 0: String(minLength) }) });
        },
      },
    );
  };

  return (
    <OGDialog open onOpenChange={(open) => !open && onClose()}>
      <OGDialogTemplate
        title={localize('com_admin_password_title')}
        className="w-11/12 md:max-w-md"
        showCloseButton={false}
        main={
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <p className="text-text-secondary text-sm">
              {localize('com_admin_password_body', { 0: who })}
            </p>
            {!user.email && (
              <p className="text-text-secondary text-xs">
                {localize('com_admin_password_no_email')}
              </p>
            )}
            <div className="space-y-1">
              <Label htmlFor={passwordId}>{localize('com_admin_password_new')}</Label>
              <SecretInput
                id={passwordId}
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPasswordValue(event.target.value)}
                aria-invalid={tooShort}
                data-testid="admin-new-password"
              />
              {tooShort && (
                <p role="alert" className="text-text-destructive text-xs">
                  {localize('com_admin_password_invalid', { 0: String(minLength) })}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor={confirmId}>{localize('com_admin_password_confirm')}</Label>
              <SecretInput
                id={confirmId}
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                aria-invalid={mismatch}
                data-testid="admin-confirm-password"
              />
              {mismatch && (
                <p role="alert" className="text-text-destructive text-xs">
                  {localize('com_auth_password_not_match')}
                </p>
              )}
            </div>
          </form>
        }
        buttons={
          <Button
            onClick={submit}
            disabled={!ready || setPassword.isLoading}
            aria-busy={setPassword.isLoading}
          >
            {setPassword.isLoading ? (
              <Spinner className="size-4" />
            ) : (
              localize('com_admin_password_save')
            )}
          </Button>
        }
      />
    </OGDialog>
  );
}
