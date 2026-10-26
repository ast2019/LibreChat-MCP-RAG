import { Progress, Skeleton } from '@librechat/client';
import type { TAdminBillingUser } from 'librechat-data-provider';
import type { CurrencyConfig } from '~/utils';
import { useGetStartupConfig } from '~/data-provider';
import { formatLocal, formatUsd } from './format';
import { useLocalize } from '~/hooks';

export function Kpi({
  label,
  value,
  local,
  hint,
}: {
  label: string;
  value?: string;
  /** The same amount in the display currency */
  local?: string | null;
  hint?: string;
}) {
  return (
    <div className="border-border-light bg-surface-secondary rounded-xl border p-4">
      <div className="text-text-secondary text-xs">{label}</div>
      {value == null ? (
        <Skeleton className="mt-2 h-6 w-20" />
      ) : (
        <div className="text-text-primary mt-1 text-xl font-semibold">{value}</div>
      )}
      {value != null && local != null && (
        <div className="text-text-primary mt-0.5 text-sm">{local}</div>
      )}
      {hint != null && <div className="text-text-secondary mt-1 text-xs">{hint}</div>}
    </div>
  );
}

/** A dollar amount with its display-currency value beneath, when one is configured. */
export function Money({ credits, currency }: { credits: number; currency?: CurrencyConfig }) {
  const local = formatLocal(credits, currency);
  return (
    <>
      <span>{formatUsd(credits)}</span>
      {local != null && <span className="text-text-secondary block text-xs">{local}</span>}
    </>
  );
}

/** The exchange rate the Toman/Rial figures use, and where it came from. */
export function RateNote({ currency }: { currency?: CurrencyConfig }) {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();
  const perDollar = formatLocal(1_000_000, currency);
  if (perDollar == null) {
    return null;
  }
  const info = startupConfig?.currencyRate;
  const updated = info?.updatedAt != null ? new Date(info.updatedAt) : null;
  const source =
    info?.source != null && info.source !== 'config'
      ? localize('com_admin_rate_live', {
          0: info.source,
          1:
            updated != null && !Number.isNaN(updated.getTime())
              ? updated.toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' })
              : '—',
        })
      : localize('com_admin_rate_fixed');
  return (
    <p className="text-text-secondary text-xs" data-testid="admin-rate">
      {localize('com_admin_rate', { 0: perDollar })} · {source}
    </p>
  );
}

export function UsageCell({ user }: { user: TAdminBillingUser }) {
  const localize = useLocalize();
  if (user.usedPercent == null) {
    return <span className="text-text-secondary text-xs">—</span>;
  }
  return (
    <div className="flex min-w-[7rem] items-center gap-2">
      <Progress
        value={user.usedPercent}
        aria-label={localize('com_ui_balance_used_label')}
        variant={user.usedPercent >= 90 ? 'warning' : 'default'}
        className="flex-1"
      />
      <span className="text-text-secondary w-9 text-end text-xs">{user.usedPercent}%</span>
    </div>
  );
}
