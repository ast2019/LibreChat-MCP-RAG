import { useState } from 'react';
import { SystemRoles } from 'librechat-data-provider';
import {
  Input,
  Label,
  Button,
  Spinner,
  OGDialog,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import type { TAdminCreateUserRequest } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { useAdminCreateUserMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const MIN_PASSWORD_LENGTH = 8;

/** Server error codes the form can explain; anything else gets the generic message. */
const ERROR_MESSAGES: Record<string, TranslationKeys> = {
  invalid_name: 'com_admin_create_user_error_name',
  invalid_email: 'com_admin_create_user_error_email',
  invalid_phone: 'com_admin_create_user_error_phone',
  contact_required: 'com_admin_create_user_error_contact',
  password_required: 'com_admin_create_user_error_password_required',
  invalid_password: 'com_admin_create_user_error_password',
  user_exists: 'com_admin_create_user_error_exists',
  admin_role_forbidden: 'com_admin_create_user_error_admin_forbidden',
};

function errorCodeOf(error: unknown): string | undefined {
  const data = (error as { response?: { data?: { error?: { code?: unknown } } } })?.response?.data;
  const code = data?.error?.code;
  return typeof code === 'string' ? code : undefined;
}

/** What still stops the form from being sent, in the order the fields appear. */
function firstProblem({
  name,
  hasEmail,
  hasPhone,
  password,
}: {
  name: string;
  hasEmail: boolean;
  hasPhone: boolean;
  password: string;
}): TranslationKeys | null {
  if (name.trim().length < 2) {
    return 'com_admin_create_user_error_name';
  }
  if (!hasEmail && !hasPhone) {
    return 'com_admin_create_user_error_contact';
  }
  if (hasEmail && password === '') {
    return 'com_admin_create_user_error_password_required';
  }
  if (password !== '' && password.length < MIN_PASSWORD_LENGTH) {
    return 'com_admin_create_user_error_password';
  }
  return null;
}

/** A form for an admin to add an account, either a regular user or another admin. */
export default function CreateUserDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const create = useAdminCreateUserMutation();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<TAdminCreateUserRequest['role']>(SystemRoles.USER);
  const [error, setError] = useState<TranslationKeys | null>(null);

  const hasEmail = email.trim() !== '';
  const hasPhone = phone.trim() !== '';
  const missing = firstProblem({ name, hasEmail, hasPhone, password });
  const canSubmit = missing == null && !create.isLoading;

  const submit = (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!canSubmit) {
      return;
    }
    setError(null);
    const payload: TAdminCreateUserRequest = {
      name: name.trim(),
      role,
      ...(hasEmail ? { email: email.trim() } : {}),
      ...(hasPhone ? { phone: phone.trim() } : {}),
      ...(password !== '' ? { password } : {}),
    };
    create.mutate(payload, {
      onSuccess: () => {
        showToast({
          status: 'success',
          message: localize(
            role === SystemRoles.ADMIN
              ? 'com_admin_create_user_success_admin'
              : 'com_admin_create_user_success',
          ),
        });
        onClose();
      },
      onError: (err) => {
        const code = errorCodeOf(err);
        setError((code != null && ERROR_MESSAGES[code]) || 'com_admin_create_user_error');
      },
    });
  };

  const roleOptions: {
    value: TAdminCreateUserRequest['role'];
    label: TranslationKeys;
    hint: TranslationKeys;
  }[] = [
    {
      value: SystemRoles.USER,
      label: 'com_admin_role_user',
      hint: 'com_admin_role_user_hint',
    },
    {
      value: SystemRoles.ADMIN,
      label: 'com_admin_role_admin',
      hint: 'com_admin_role_admin_hint',
    },
  ];

  return (
    <OGDialog open={open} onOpenChange={(next) => !next && onClose()}>
      <OGDialogTemplate
        title={localize('com_admin_create_user_title')}
        description={localize('com_admin_create_user_description')}
        className="w-11/12 md:max-w-lg"
        showCloseButton={false}
        main={
          <form id="admin-create-user" onSubmit={submit} className="space-y-4" noValidate>
            <div className="space-y-1">
              <Label htmlFor="create-user-name">{localize('com_auth_full_name')}</Label>
              <Input
                id="create-user-name"
                value={name}
                autoComplete="off"
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                required
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="create-user-email">{localize('com_auth_email')}</Label>
                <Input
                  id="create-user-email"
                  type="email"
                  dir="ltr"
                  autoComplete="off"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@example.com"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="create-user-phone">{localize('com_admin_create_user_phone')}</Label>
                <Input
                  id="create-user-phone"
                  type="tel"
                  dir="ltr"
                  inputMode="tel"
                  autoComplete="off"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="09121234567"
                />
              </div>
            </div>
            <p className="text-text-secondary -mt-2 text-xs">
              {localize('com_admin_create_user_contact_hint')}
            </p>

            <div className="space-y-1">
              <Label htmlFor="create-user-password">{localize('com_auth_password')}</Label>
              <Input
                id="create-user-password"
                type="password"
                dir="ltr"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-describedby="create-user-password-hint"
              />
              <p id="create-user-password-hint" className="text-text-secondary text-xs">
                {localize('com_admin_create_user_password_hint', { 0: MIN_PASSWORD_LENGTH })}
              </p>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-text-primary mb-1 text-sm font-medium">
                {localize('com_admin_create_user_role')}
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {roleOptions.map((option) => (
                  <label
                    key={option.value}
                    className={cn(
                      'border-border-light hover:bg-surface-hover flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2',
                      role === option.value && 'border-border-heavy bg-surface-secondary',
                    )}
                  >
                    <input
                      type="radio"
                      name="create-user-role"
                      value={option.value}
                      checked={role === option.value}
                      onChange={() => setRole(option.value)}
                      className="mt-1"
                    />
                    <span className="flex flex-col">
                      <span className="text-text-primary text-sm">{localize(option.label)}</span>
                      <span className="text-text-secondary text-xs">{localize(option.hint)}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {error != null && (
              <p role="alert" className="text-text-destructive text-sm">
                {localize(error)}
              </p>
            )}
          </form>
        }
        buttons={
          <Button
            type="submit"
            form="admin-create-user"
            disabled={!canSubmit}
            aria-busy={create.isLoading}
            title={missing != null ? localize(missing) : undefined}
          >
            {create.isLoading ? (
              <Spinner className="size-4" />
            ) : (
              localize('com_admin_create_user_submit')
            )}
          </Button>
        }
      />
    </OGDialog>
  );
}
