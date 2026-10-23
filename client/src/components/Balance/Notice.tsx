import { useState } from 'react';
import { X } from 'lucide-react';
import { Alert, Button } from '@librechat/client';
import useBalanceSummary from '~/hooks/useBalanceSummary';
import { useGetStartupConfig } from '~/data-provider';
import useLocalize from '~/hooks/useLocalize';

/**
 * Warns above the composer once the user has spent 90% of their allotment, and again when
 * credits run out. Links to the deployment's `balance.purchaseUrl` when one is configured.
 * Dismissing hides the current warning until the tone changes (e.g. low → empty).
 */
function Notice() {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();
  const { enabled, state } = useBalanceSummary();
  const [dismissedTone, setDismissedTone] = useState<string | null>(null);

  if (!enabled || state.status !== 'success') {
    return null;
  }
  const { tone, usedPercent } = state.summary;
  if (tone === 'normal' || dismissedTone === tone) {
    return null;
  }

  const purchaseUrl = startupConfig?.balance?.purchaseUrl;
  const empty = tone === 'danger';
  const message = empty
    ? localize('com_ui_balance_notice_empty')
    : localize('com_ui_balance_notice_low', { 0: String(usedPercent ?? 90) });

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-2 xl:max-w-4xl">
      <Alert
        variant={empty ? 'error' : 'warning'}
        role={empty ? 'alert' : 'status'}
        data-testid="balance-notice"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="min-w-0 flex-1">{message}</span>
          {purchaseUrl != null && purchaseUrl !== '' && (
            <Button asChild size="compact" variant="outline">
              <a href={purchaseUrl} target="_blank" rel="noopener noreferrer">
                {localize('com_ui_balance_buy_pack')}
              </a>
            </Button>
          )}
          <Button
            size="compact"
            variant="ghost"
            aria-label={localize('com_ui_dismiss')}
            onClick={() => setDismissedTone(tone)}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </Alert>
    </div>
  );
}

export default Notice;
