import { useState } from 'react';
import { X } from 'lucide-react';
import { Alert, Button } from '@librechat/client';
import { PurchaseLink, usePurchaseTarget } from './Purchase';
import useBalanceSummary from '~/hooks/useBalanceSummary';
import useLocalize from '~/hooks/useLocalize';

/**
 * Warns above the composer once the user has spent 90% of their allotment, and again when
 * credits run out. Links to the in-app purchase page when a gateway is usable, else to the
 * deployment's `balance.purchaseUrl` when one is configured.
 *
 * Dismissing hides the current warning until the warning itself changes. The dismissal is
 * keyed by the grant the warning is measured against, not by the tone alone: a tone-keyed
 * dismissal would hide the next pack's warning forever, because a new pack spends the same
 * two tones. It is keyed by the grant rather than by the share spent, because the share is
 * floored — a warning that grows from 90% to 95% is the same warning to the user.
 */
function Notice() {
  const localize = useLocalize();
  const purchase = usePurchaseTarget();
  const { enabled, state } = useBalanceSummary();
  const [dismissed, setDismissed] = useState<string | null>(null);

  if (!enabled || state.status !== 'success') {
    return null;
  }
  const { tone, usedPercent } = state.summary;
  if (tone === 'normal') {
    return null;
  }

  const empty = tone === 'danger';
  /** What the warning is about: the grant it is measured against, and which warning it is. */
  const warningKey = `${empty ? 'empty' : 'low'}:${state.summary.packId ?? ''}:${state.summary.packGrantedAt ?? ''}`;
  if (dismissed === warningKey) {
    return null;
  }

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
          {purchase != null && (
            <Button asChild size="compact" variant="outline">
              <PurchaseLink target={purchase}>{localize('com_ui_balance_buy_pack')}</PurchaseLink>
            </Button>
          )}
          <Button
            size="compact"
            variant="ghost"
            aria-label={localize('com_ui_dismiss')}
            onClick={() => setDismissed(warningKey)}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </Alert>
    </div>
  );
}

export default Notice;
