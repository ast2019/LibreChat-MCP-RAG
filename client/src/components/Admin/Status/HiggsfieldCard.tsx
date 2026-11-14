import { useEffect, useState } from 'react';
import { Input, Label, Button, Skeleton, useToastContext } from '@librechat/client';
import type { TAdminHiggsfieldStatus } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { useAdminHiggsfieldQuery, useUpdateAdminHiggsfieldMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

/** The shared account's state in one sentence for the admin. */
function ownerStateKey(status: TAdminHiggsfieldStatus): TranslationKeys {
  const { owner } = status;
  if (!owner.email) {
    return 'com_admin_higgsfield_owner_not_set';
  }
  if (!owner.found) {
    return 'com_admin_higgsfield_owner_not_found';
  }
  return owner.connected
    ? 'com_admin_higgsfield_owner_connected'
    : 'com_admin_higgsfield_owner_not_connected';
}

const ERROR_KEYS: Record<string, TranslationKeys> = {
  owner_not_found: 'com_admin_higgsfield_owner_not_found',
  invalid_owner_email: 'com_admin_higgsfield_invalid_email',
};

function errorCodeOf(error: unknown): string | undefined {
  const data = (error as { response?: { data?: { error?: { code?: string } } } })?.response?.data;
  return data?.error?.code;
}

/**
 * Higgsfield in the status tab: whether the API keys are set in the environment, and which
 * account's MCP connection is shared. The owner is picked here by email; clearing it falls back
 * to the config file's HIGGSFIELD_SHARED_OWNER_EMAIL.
 */
export default function HiggsfieldCard() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const query = useAdminHiggsfieldQuery();
  const save = useUpdateAdminHiggsfieldMutation();
  const [email, setEmail] = useState('');
  const data = query.data;

  useEffect(() => {
    setEmail(data?.owner.source === 'admin' ? (data.owner.email ?? '') : '');
  }, [data?.owner.email, data?.owner.source]);

  if (query.isLoading) {
    return <Skeleton className="h-40 w-full" />;
  }
  if (data == null || (data.mcpServer == null && !data.apiDeclared)) {
    return null;
  }

  const submit = (ownerEmail: string | null) =>
    save.mutate(
      { ownerEmail },
      {
        onSuccess: () => showToast({ status: 'success', message: localize('com_admin_saved') }),
        onError: (error) => {
          const key = ERROR_KEYS[errorCodeOf(error) ?? ''] ?? 'com_admin_save_error';
          showToast({ status: 'error', message: localize(key) });
        },
      },
    );

  const trimmed = email.trim();
  return (
    <section
      aria-labelledby="higgsfield-settings"
      className="border-border-light space-y-3 rounded-xl border p-4"
    >
      <h3 id="higgsfield-settings" className="text-text-primary text-sm font-medium">
        {localize('com_admin_higgsfield_title')}
      </h3>

      {data.apiDeclared && (
        <p className="text-text-secondary text-sm">
          {localize(
            data.apiKeysSet
              ? 'com_admin_higgsfield_api_keys_set'
              : 'com_admin_higgsfield_api_keys_missing',
          )}
        </p>
      )}

      {data.mcpServer != null && !data.sharingEnabled && (
        <p className="text-text-secondary text-sm">
          {localize('com_admin_higgsfield_sharing_off')}
        </p>
      )}

      {data.mcpServer != null && data.sharingEnabled && (
        <div className="space-y-2">
          <p className="text-text-secondary text-sm">
            {localize(ownerStateKey(data), { 0: data.owner.email ?? '' })}
          </p>
          {data.owner.source === 'env' && (
            <p className="text-text-secondary text-xs">
              {localize('com_admin_higgsfield_owner_from_env')}
            </p>
          )}
          <Label htmlFor="higgsfield-owner-email">
            {localize('com_admin_higgsfield_owner_label')}
          </Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="higgsfield-owner-email"
              type="email"
              dir="ltr"
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="max-w-xs"
            />
            <Button
              size="sm"
              onClick={() => submit(trimmed)}
              disabled={!trimmed || save.isLoading}
              aria-busy={save.isLoading}
            >
              {localize('com_ui_save')}
            </Button>
            {data.owner.source === 'admin' && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => submit(null)}
                disabled={save.isLoading}
              >
                {localize('com_admin_higgsfield_owner_clear')}
              </Button>
            )}
          </div>
          <p className="text-text-secondary text-xs">
            {localize('com_admin_higgsfield_owner_hint')}
          </p>
        </div>
      )}
    </section>
  );
}
