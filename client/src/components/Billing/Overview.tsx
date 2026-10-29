import { useState } from 'react';
import { Button } from '@librechat/client';
import { useAdminBillingSummaryQuery } from '~/data-provider';
import { useBalanceDisplay } from '~/hooks/useBalanceSummary';
import { formatLocal, formatUsd } from './format';
import { Kpi, Money, RateNote } from './parts';
import { useLocalize } from '~/hooks';
import GiftNote from './GiftNote';

const WINDOWS = [7, 30, 90] as const;

/** Sales and spend in a time window, the exchange rate, and the models that cost the most. */
export default function Overview() {
  const localize = useLocalize();
  const [days, setDays] = useState<number>(30);
  const summary = useAdminBillingSummaryQuery(days);
  const { currency } = useBalanceDisplay();
  const data = summary.data;
  const margin = data ? data.creditsSpentInWindow - data.estimatedProviderCredits : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <RateNote currency={currency} />
        </div>
        <div role="group" aria-label={localize('com_admin_window')} className="flex gap-1">
          {WINDOWS.map((value) => (
            <Button
              key={value}
              size="compact"
              variant={days === value ? 'default' : 'outline'}
              aria-pressed={days === value}
              onClick={() => setDays(value)}
            >
              {localize('com_admin_days', { 0: String(value) })}
            </Button>
          ))}
        </div>
      </div>

      <GiftNote />

      {summary.isError ? (
        <p role="alert" className="text-text-destructive text-sm">
          {localize('com_admin_load_error')}
        </p>
      ) : (
        <section
          aria-label={localize('com_admin_summary')}
          className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6"
        >
          <Kpi
            label={localize('com_admin_users')}
            value={data ? String(data.totalUsers) : undefined}
            hint={data ? localize('com_admin_active', { 0: String(data.activeUsers) }) : undefined}
          />
          <Kpi
            label={localize('com_admin_granted')}
            value={data ? formatUsd(data.creditsGrantedInWindow) : undefined}
            local={data ? formatLocal(data.creditsGrantedInWindow, currency) : undefined}
            hint={
              data
                ? localize('com_admin_packs_count', { 0: String(data.packGrantsInWindow) })
                : undefined
            }
          />
          <Kpi
            label={localize('com_admin_spent')}
            value={data ? formatUsd(data.creditsSpentInWindow) : undefined}
            local={data ? formatLocal(data.creditsSpentInWindow, currency) : undefined}
          />
          <Kpi
            label={localize('com_admin_provider_cost')}
            value={data ? formatUsd(data.estimatedProviderCredits) : undefined}
            local={data ? formatLocal(data.estimatedProviderCredits, currency) : undefined}
            hint={data ? `×${data.priceMultiplier}` : undefined}
          />
          <Kpi
            label={localize('com_admin_margin')}
            value={margin != null ? formatUsd(margin) : undefined}
            local={margin != null ? formatLocal(margin, currency) : undefined}
          />
          <Kpi
            label={localize('com_admin_outstanding')}
            value={data ? formatUsd(data.creditsOutstanding) : undefined}
            local={data ? formatLocal(data.creditsOutstanding, currency) : undefined}
          />
        </section>
      )}

      {data && data.topModels.length > 0 && (
        <section aria-labelledby="admin-models" className="space-y-2">
          <h2 id="admin-models" className="text-text-primary text-sm font-medium">
            {localize('com_admin_top_models')}
          </h2>
          <ul className="border-border-light divide-border-light divide-y rounded-xl border">
            {data.topModels.map((row) => (
              <li key={row.model} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-text-primary truncate font-mono text-xs">{row.model}</span>
                <span className="text-text-secondary text-end">
                  <Money credits={row.credits} currency={currency} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
