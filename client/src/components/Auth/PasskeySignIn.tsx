import React from 'react';
import { Fingerprint } from 'lucide-react';
import { Button, Spinner } from '@librechat/client';
import { usePasskeySignIn } from '~/hooks/Auth/usePasskey';
import { useLocalize } from '~/hooks';

/**
 * Sign-in affordance for discoverable passkeys: a full-width secondary button in the
 * same shape as the password form's submit, so it reads as an equal way in and names
 * the gesture (fingerprint / face) instead of the jargon alone.
 *
 * Mounting this also arms the browser's conditional (autofill) ceremony, which
 * is why it renders even while the button itself is busy.
 */
function PasskeySignIn({ enabled }: { enabled: boolean }) {
  const localize = useLocalize();
  const { signIn, isSigningIn } = usePasskeySignIn({ enabled });

  if (!enabled) {
    return null;
  }

  const label = localize('com_auth_passkey_login_biometric');

  return (
    <div className="mt-2">
      <Button
        type="button"
        data-testid="passkey"
        variant="outline"
        shape="soft"
        size="auth"
        onClick={() => void signIn()}
        disabled={isSigningIn}
        aria-busy={isSigningIn}
        className="w-full"
      >
        {isSigningIn ? (
          <Spinner className="size-5" />
        ) : (
          <Fingerprint className="size-5 shrink-0" aria-hidden="true" />
        )}
        <span>{label}</span>
      </Button>
    </div>
  );
}

export default React.memo(PasskeySignIn);
