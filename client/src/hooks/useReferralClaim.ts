import { useEffect, useRef } from 'react';
import { useToastContext } from '@librechat/client';
import type { TStartupConfig } from 'librechat-data-provider';
import { clearStoredReferralCode, getStoredReferralCode } from '~/utils/referral';
import { useClaimReferralMutation } from '~/data-provider';
import { formatBalanceAmount } from '~/utils';
import useLocalize from './useLocalize';

/**
 * Once signed in, hands the invite code this browser arrived with to the server. A code that is
 * settled (paid, refused, or no longer claimable) is forgotten; one waiting on a verified
 * mobile stays and is tried again on the next visit.
 */
export default function useReferralClaim(startupConfig?: TStartupConfig | null): void {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const claim = useClaimReferralMutation();
  const attempted = useRef(false);
  const enabled = startupConfig?.referral?.enabled === true;
  const currency = startupConfig?.interface?.currency;

  useEffect(() => {
    if (!enabled || attempted.current) {
      return;
    }
    const code = getStoredReferralCode();
    if (!code) {
      return;
    }
    attempted.current = true;
    claim.mutate(code, {
      onSuccess: (result) => {
        if (result.status === 'pending_phone') {
          showToast({ message: localize('com_ui_referral_pending_phone'), status: 'info' });
          return;
        }
        clearStoredReferralCode();
        if ((result.status === 'rewarded' || result.status === 'capped') && result.credits) {
          showToast({
            message: localize('com_ui_referral_welcome_credited', {
              0: formatBalanceAmount(result.credits, 'currency', currency),
            }),
            status: 'success',
          });
        }
      },
    });
  }, [enabled, claim, currency, localize, showToast]);
}
