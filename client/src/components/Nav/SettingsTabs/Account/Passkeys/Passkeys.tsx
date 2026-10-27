import React, { useCallback, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { MAX_PASSKEYS_PER_USER } from 'librechat-data-provider';
import {
  Button,
  EmptyState,
  Label,
  OGDialog,
  OGDialogContent,
  OGDialogDescription,
  OGDialogHeader,
  OGDialogTitle,
  OGDialogTrigger,
  PasskeyIcon,
  Skeleton,
  useToastContext,
} from '@librechat/client';
import type { TPasskey } from 'librechat-data-provider';
import type { PasskeyRemovalResult } from './PasskeyItem';
import {
  useDeletePasskeyMutation,
  useGetStartupConfig,
  usePasskeysQuery,
  useRenamePasskeyMutation,
} from '~/data-provider';
import { isPasswordRejection, usePasskeyRegistration } from '~/hooks/Auth/usePasskey';
import { useAuthContext, useLocalize } from '~/hooks';
import AddPasskeyDialog, { ADD_PASSKEY_DIALOG_ID } from './AddPasskeyDialog';
import PasskeyItem from './PasskeyItem';

function Passkeys() {
  const localize = useLocalize();
  const { user } = useAuthContext();
  const { showToast } = useToastContext();
  const [isDialogOpen, setDialogOpen] = useState(false);
  const [isAddDialogOpen, setAddDialogOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const renameAfterCloseRef = useRef<string | null>(null);

  const { data, isLoading, isError } = usePasskeysQuery({ enabled: isDialogOpen });
  const { data: startupConfig, refetch: refetchStartupConfig } = useGetStartupConfig();
  const { registerPasskey, isRegistering, passwordErrorKey, clearPasswordError } =
    usePasskeyRegistration();
  const { mutate: renameMutate } = useRenamePasskeyMutation();
  const { mutateAsync: deleteMutate } = useDeletePasskeyMutation();

  const passkeys = data?.passkeys ?? [];
  /** Falls back to the documented default while the startup config is still loading. */
  const maxPasskeys = startupConfig?.maxPasskeysPerUser ?? MAX_PASSKEYS_PER_USER;
  const atLimit = passkeys.length >= maxPasskeys;
  /**
   * Removing a passkey is password-confirmed, but an account provisioned by an
   * identity provider has no password to confirm with. The server waives the
   * check for those accounts so a credential enrolled before the provider check
   * existed stays removable, and the form must not demand one either. Those same
   * accounts cannot enroll new credentials, so the panel stays reachable for
   * cleanup while the add control is hidden.
   */
  const isLocalAccount = user?.provider === 'local';

  const handleAdd = useCallback(() => {
    clearPasswordError();
    setAddDialogOpen(true);
  }, [clearPasswordError]);

  /** Start rename after the child dialog releases its focus trap. */
  const handleAdded = useCallback((passkey: TPasskey) => {
    renameAfterCloseRef.current = passkey.id;
  }, []);

  const handleAddCloseAutoFocus = useCallback((event: Event) => {
    event.preventDefault();
    const passkeyId = renameAfterCloseRef.current;
    renameAfterCloseRef.current = null;
    if (passkeyId != null) {
      setRenamingId(passkeyId);
      return;
    }
    addButtonRef.current?.focus();
  }, []);

  const handleRename = useCallback(
    (passkeyId: string, name: string) => {
      setPendingId(passkeyId);
      renameMutate(
        { passkeyId, name },
        {
          onSuccess: () => setRenamingId(null),
          onError: () =>
            showToast({ message: localize('com_ui_passkey_rename_error'), status: 'error' }),
          onSettled: () => setPendingId(null),
        },
      );
    },
    [renameMutate, localize, showToast],
  );

  const handleDelete = useCallback(
    async (passkeyId: string, password: string): Promise<PasskeyRemovalResult> => {
      setPendingId(passkeyId);
      try {
        await deleteMutate({ passkeyId, password: password === '' ? undefined : password });
        showToast({ message: localize('com_ui_passkey_removed') });
        return 'removed';
      } catch (error) {
        if (isPasswordRejection(error)) {
          return 'incorrect-password';
        }
        showToast({ message: localize('com_ui_passkey_remove_error'), status: 'error' });
        return 'failed';
      } finally {
        setPendingId(null);
      }
    },
    [deleteMutate, localize, showToast],
  );

  /**
   * Escape, the backdrop and the close button all route through here. The step-up form
   * holds the account password, so closing must drop it rather than leave it staged to
   * reappear the next time the dialog opens.
   */
  const handleOpenChange = useCallback(
    (open: boolean) => {
      setDialogOpen(open);
      if (open) {
        void refetchStartupConfig();
        return;
      }
      setAddDialogOpen(false);
      setRenamingId(null);
      renameAfterCloseRef.current = null;
      clearPasswordError();
    },
    [clearPasswordError, refetchStartupConfig],
  );

  return (
    <OGDialog open={isDialogOpen} onOpenChange={handleOpenChange}>
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Label className="font-light">{localize('com_ui_passkeys')}</Label>
        </div>
        <OGDialogTrigger asChild>
          <Button variant="outline" aria-label={localize('com_ui_passkeys')}>
            {localize('com_ui_manage')}
          </Button>
        </OGDialogTrigger>
      </div>

      <OGDialogContent className="w-11/12 max-w-lg" showCloseButton={true}>
        <OGDialogHeader>
          <OGDialogTitle>
            <div className="flex items-center gap-3 text-xl font-semibold">
              <span className="text-text-secondary">
                <PasskeyIcon className="h-5 w-5" />
              </span>
              {localize('com_ui_passkeys')}
            </div>
          </OGDialogTitle>
          <OGDialogDescription>{localize('com_ui_passkeys_description')}</OGDialogDescription>
        </OGDialogHeader>

        <div className="mt-4">
          {isLoading && (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-16 w-full rounded-xl" />
            </div>
          )}
          {!isLoading && isError && (
            <div
              role="alert"
              className="border-border-light flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center"
            >
              <span className="text-text-tertiary">
                <PasskeyIcon className="h-6 w-6" />
              </span>
              <p className="text-text-secondary text-sm">{localize('com_ui_passkey_load_error')}</p>
            </div>
          )}
          {!isLoading && !isError && passkeys.length === 0 && (
            <EmptyState
              icon={PasskeyIcon}
              title={localize('com_ui_passkey_empty')}
              description={localize('com_ui_passkey_empty_description')}
            />
          )}
          {!isLoading && passkeys.length > 0 && (
            <ul className="space-y-1.5">
              <AnimatePresence initial={false}>
                {passkeys.map((passkey) => (
                  <motion.li
                    key={passkey.id}
                    layout
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.15 }}
                    className="list-none"
                  >
                    <PasskeyItem
                      passkey={passkey}
                      isRenaming={renamingId === passkey.id}
                      isBusy={pendingId === passkey.id}
                      requiresPassword={isLocalAccount}
                      onStartRename={setRenamingId}
                      onRename={handleRename}
                      onDelete={handleDelete}
                    />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </div>

        {isLocalAccount && (
          <div className="mt-6 flex flex-col items-end gap-2">
            <Button
              ref={addButtonRef}
              variant="submit"
              onClick={handleAdd}
              disabled={isRegistering || atLimit || isLoading}
              aria-haspopup="dialog"
              aria-expanded={isAddDialogOpen}
              aria-controls={ADD_PASSKEY_DIALOG_ID}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {localize('com_ui_passkey_add')}
            </Button>
            {atLimit && (
              <p className="text-text-secondary text-xs">
                {localize('com_ui_passkey_limit_reached')}
              </p>
            )}
          </div>
        )}
      </OGDialogContent>

      <AddPasskeyDialog
        open={isAddDialogOpen}
        onOpenChange={setAddDialogOpen}
        registerPasskey={registerPasskey}
        isRegistering={isRegistering}
        passwordErrorKey={passwordErrorKey}
        clearPasswordError={clearPasswordError}
        onAdded={handleAdded}
        onCloseAutoFocus={handleAddCloseAutoFocus}
      />
    </OGDialog>
  );
}

export default React.memo(Passkeys);
