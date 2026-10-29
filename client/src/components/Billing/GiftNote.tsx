import { Gift } from 'lucide-react';
import { useAdminBillingPacksQuery } from '~/data-provider';
import { useBalanceDisplay } from '~/hooks/useBalanceSummary';
import { formatLocal, formatUsd } from './format';
import { useLocalize } from '~/hooks';

/** The welcome gift every new account gets on sign-up, so admins know it is being handed out. */
export default function GiftNote({ compact = false }: { compact?: boolean }) {
  const localize = useLocalize();
  const packs = useAdminBillingPacksQuery();
  const { currency } = useBalanceDisplay();
  const credits = packs.data?.startBalance ?? 0;
  if (!(credits > 0)) {
    return null;
  }
  const local = formatLocal(credits, currency);
  const amount = local != null ? `${formatUsd(credits)} (${local})` : formatUsd(credits);
  return (
    <p
      className="bg-status-info-subtle border-status-info-border text-text-primary flex items-start gap-2 rounded-xl border px-3 py-2 text-sm"
      data-testid="admin-gift-note"
    >
      <Gift className="text-status-info mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>
        {localize(compact ? 'com_admin_gift_note_new_user' : 'com_admin_gift_note', { 0: amount })}
      </span>
    </p>
  );
}
