import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Label,
  OGDialog,
  OGDialogClose,
  OGDialogContent,
  OGDialogDescription,
  OGDialogFooter,
  OGDialogHeader,
  OGDialogTitle,
  SecretInput,
  Spinner,
} from '@librechat/client';
import type { TPasskey } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks/useLocalize';
import { useLocalize } from '~/hooks';

const PASSWORD_FIELD_ID = 'passkey-confirm-password';
const PASSWORD_ERROR_ID = 'passkey-confirm-password-error';
const PASSWORD_FORM_ID = 'passkey-confirm-password-form';
export const ADD_PASSKEY_DIALOG_ID = 'add-passkey-dialog';

export type AddPasskeyDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The ceremony from `usePasskeyRegistration`, owned by the caller so it can reflect the busy state. */
  registerPasskey: (password: string) => Promise<TPasskey | null>;
  isRegistering: boolean;
  passwordErrorKey: TranslationKeys | null;
  clearPasswordError: () => void;
  /** Called once the passkey is stored, before the dialog closes. */
  onAdded?: (passkey: TPasskey) => void;
  onCloseAutoFocus?: (event: Event) => void;
};

/**
 * Password step-up + WebAuthn enrollment. Both server steps need the account password,
 * so the settings panel and the post-login nudge share this one dialog rather than each
 * re-implementing the form, its error wiring and its focus handling.
 */
function AddPasskeyDialog({
  open,
  onOpenChange,
  registerPasskey,
  isRegistering,
  passwordErrorKey,
  clearPasswordError,
  onAdded,
  onCloseAutoFocus,
}: AddPasskeyDialogProps) {
  const localize = useLocalize();
  const [password, setPassword] = useState('');
  const passwordRef = useRef<HTMLInputElement | null>(null);

  /** However the dialog closes (cancel, Escape, a parent closing it), the password is dropped. */
  useEffect(() => {
    if (!open) {
      setPassword('');
      clearPasswordError();
    }
  }, [open, clearPasswordError]);

  /** Callback ref so the field takes focus the moment the step-up form appears. */
  const bindPasswordField = useCallback((input: HTMLInputElement | null) => {
    passwordRef.current = input;
    input?.focus();
  }, []);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const passkey = await registerPasskey(password);
      if (!passkey) {
        /** Put focus back on the field the error describes so it can be corrected. */
        passwordRef.current?.focus();
        return;
      }
      setPassword('');
      onAdded?.(passkey);
      onOpenChange(false);
    },
    [password, registerPasskey, onAdded, onOpenChange],
  );

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogContent
        id={ADD_PASSKEY_DIALOG_ID}
        className="w-11/12 max-w-md"
        showCloseButton={false}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <OGDialogHeader>
          <OGDialogTitle>{localize('com_ui_passkey_add')}</OGDialogTitle>
          <OGDialogDescription>
            {localize('com_ui_passkey_confirm_password_description')}
          </OGDialogDescription>
        </OGDialogHeader>

        <form id={PASSWORD_FORM_ID} onSubmit={handleSubmit} className="flex flex-col gap-2">
          <Label htmlFor={PASSWORD_FIELD_ID} className="text-sm font-medium">
            {localize('com_ui_passkey_confirm_password')}
          </Label>
          <SecretInput
            id={PASSWORD_FIELD_ID}
            ref={bindPasswordField}
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={passwordErrorKey != null}
            aria-describedby={passwordErrorKey != null ? PASSWORD_ERROR_ID : undefined}
          />
          {passwordErrorKey != null && (
            <p id={PASSWORD_ERROR_ID} role="alert" className="text-text-destructive text-xs">
              {localize(passwordErrorKey)}
            </p>
          )}
          <OGDialogFooter className="mt-2">
            <OGDialogClose asChild>
              <Button type="button" variant="outline">
                {localize('com_ui_cancel')}
              </Button>
            </OGDialogClose>
            <Button type="submit" variant="submit" disabled={isRegistering || password === ''}>
              {isRegistering && <Spinner className="h-4 w-4" />}
              {localize('com_ui_confirm')}
            </Button>
          </OGDialogFooter>
        </form>
      </OGDialogContent>
    </OGDialog>
  );
}

export default React.memo(AddPasskeyDialog);
