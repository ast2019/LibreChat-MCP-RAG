import React, { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Fingerprint } from 'lucide-react';
import { Button } from '@librechat/client';
import AddPasskeyDialog from '~/components/Nav/SettingsTabs/Account/Passkeys/AddPasskeyDialog';
import { passkeysSupported, usePasskeyRegistration } from '~/hooks/Auth/usePasskey';
import { useGetStartupConfig, usePasskeysQuery } from '~/data-provider';
import { useAuthContext, useLocalize } from '~/hooks';
import {
  canOfferPasskeyNudge,
  dismissPasskeyNudge,
  isPasskeyNudgeDismissed,
  shouldShowPasskeyNudge,
} from './passkeyNudge';

/**
 * A quiet, dismissible card that invites a password user with no passkey to add one.
 * It reuses the settings panel's enrollment dialog and ceremony, so the two entry
 * points can never drift apart. "Later" is remembered per user in localStorage.
 */
function PasskeyNudge({ onVisibilityChange }: { onVisibilityChange?: (visible: boolean) => void }) {
  const localize = useLocalize();
  const titleId = useId();
  const { user } = useAuthContext();
  const { data: startupConfig } = useGetStartupConfig();
  const [dismissedNow, setDismissedNow] = useState(false);
  const [isDialogOpen, setDialogOpen] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  const userId = user?.id;
  const storedDismissal = useMemo(() => isPasskeyNudgeDismissed(userId), [userId]);
  const eligibility = {
    passkeyLoginEnabled: startupConfig?.passkeyLoginEnabled,
    supported: passkeysSupported(),
    userId,
    provider: user?.provider,
    dismissed: dismissedNow || storedDismissal,
  };
  const canOffer = canOfferPasskeyNudge(eligibility);

  const { data, isError } = usePasskeysQuery({ enabled: canOffer });
  const { registerPasskey, isRegistering, passwordErrorKey, clearPasswordError } =
    usePasskeyRegistration();

  const passkeyCount = isError ? undefined : data?.passkeys.length;
  const visible = shouldShowPasskeyNudge(eligibility, passkeyCount);

  /** The landing measures its content to keep the greeting clear of the composer. */
  useLayoutEffect(() => {
    onVisibilityChange?.(visible);
  }, [visible, onVisibilityChange]);

  const handleLater = useCallback(() => {
    dismissPasskeyNudge(userId);
    setDismissedNow(true);
  }, [userId]);

  const handleOpen = useCallback(() => {
    clearPasswordError();
    setDialogOpen(true);
  }, [clearPasswordError]);

  /** Once a passkey exists the invitation has done its job, even if it is removed later. */
  const handleAdded = useCallback(() => {
    dismissPasskeyNudge(userId);
    setDismissedNow(true);
  }, [userId]);

  const handleCloseAutoFocus = useCallback((event: Event) => {
    if (addButtonRef.current?.isConnected) {
      event.preventDefault();
      addButtonRef.current.focus();
    }
  }, []);

  return (
    <>
      {visible && (
        <section
          aria-labelledby={titleId}
          data-testid="passkey-nudge"
          className="animate-fadeIn border-border-light bg-surface-secondary mt-6 flex w-96 max-w-[calc(100vw-2rem)] items-start gap-3 rounded-2xl border p-4 text-start"
        >
          <span className="bg-surface-tertiary text-text-primary flex size-9 shrink-0 items-center justify-center rounded-full">
            <Fingerprint className="size-5" aria-hidden="true" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 id={titleId} className="text-text-primary text-sm font-semibold">
              {localize('com_ui_passkey_nudge_title')}
            </h2>
            <p className="text-text-secondary text-xs">
              {localize('com_ui_passkey_nudge_description')}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                ref={addButtonRef}
                type="button"
                size="sm"
                variant="submit"
                onClick={handleOpen}
                disabled={isRegistering}
                aria-haspopup="dialog"
                aria-expanded={isDialogOpen}
              >
                {localize('com_ui_passkey_add')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-text-primary"
                onClick={handleLater}
              >
                {localize('com_ui_passkey_nudge_later')}
              </Button>
            </div>
          </div>
        </section>
      )}
      {canOffer || isDialogOpen ? (
        <AddPasskeyDialog
          open={isDialogOpen}
          onOpenChange={setDialogOpen}
          registerPasskey={registerPasskey}
          isRegistering={isRegistering}
          passwordErrorKey={passwordErrorKey}
          clearPasswordError={clearPasswordError}
          onAdded={handleAdded}
          onCloseAutoFocus={handleCloseAutoFocus}
        />
      ) : null}
    </>
  );
}

export default React.memo(PasskeyNudge);
