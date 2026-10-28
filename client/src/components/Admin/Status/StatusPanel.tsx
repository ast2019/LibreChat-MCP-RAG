import { Activity } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, EmptyState, Skeleton, Spinner } from '@librechat/client';
import { useAdminServiceStatusQuery, useRefreshAdminServiceStatusMutation } from '~/data-provider';
import { useBalanceDisplay } from '~/hooks/useBalanceSummary';
import { SERVICE_NAME_KEYS, formatNumber } from './format';
import ServiceCard from './ServiceCard';
import { useLocalize } from '~/hooks';

const SKELETON_CARDS = 6;

function ChainSummary({
  chain,
  active,
  locale,
}: {
  chain: string[];
  active: string | null;
  locale: string;
}) {
  const localize = useLocalize();
  if (chain.length === 0) {
    return <p className="text-text-secondary text-sm">{localize('com_admin_status_no_chain')}</p>;
  }
  const nameOf = (id: string) =>
    id in SERVICE_NAME_KEYS
      ? localize(SERVICE_NAME_KEYS[id as keyof typeof SERVICE_NAME_KEYS])
      : id;
  return (
    <section aria-labelledby="status-chain" className="space-y-2">
      <h3 id="status-chain" className="text-text-primary text-sm font-medium">
        {localize('com_admin_status_chain')}
      </h3>
      <ol className="flex flex-wrap items-center gap-2 text-xs">
        {chain.map((id, index) => (
          <li
            key={id}
            aria-current={id === active ? 'true' : undefined}
            className={
              id === active
                ? 'border-status-info-border bg-status-info-subtle text-text-primary rounded-full border px-2.5 py-1 font-semibold'
                : 'border-border-light text-text-secondary rounded-full border px-2.5 py-1'
            }
          >
            {formatNumber(index + 1, locale)}. {nameOf(id)}
          </li>
        ))}
      </ol>
      <p className="text-text-primary text-sm" data-testid="status-active">
        {active != null
          ? localize('com_admin_status_active', { 0: nameOf(active) })
          : localize('com_admin_status_no_active')}
      </p>
    </section>
  );
}

/** The «service status» admin tab: credit, health and failover state of every external service. */
export default function StatusPanel() {
  const localize = useLocalize();
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'fa';
  const { currency } = useBalanceDisplay();
  const status = useAdminServiceStatusQuery();
  const refresh = useRefreshAdminServiceStatusMutation();
  const data = status.data;
  /** Relative times count from when this status arrived. */
  const now = status.dataUpdatedAt || Date.now();

  const refreshButton = (
    <Button
      size="compact"
      variant="outline"
      onClick={() => refresh.mutate()}
      disabled={refresh.isLoading}
      aria-busy={refresh.isLoading}
    >
      {refresh.isLoading && <Spinner className="me-1.5 size-3.5" aria-hidden="true" />}
      {localize(refresh.isLoading ? 'com_admin_status_refreshing' : 'com_admin_status_refresh')}
    </Button>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="text-text-primary text-base font-semibold">
            {localize('com_admin_status_title')}
          </h2>
          <p className="text-text-secondary text-sm">
            {localize('com_admin_status_description', {
              0: formatNumber(Math.round((data?.refreshIntervalSeconds ?? 600) / 60), locale),
            })}
          </p>
        </div>
        {refreshButton}
      </div>

      {refresh.isError && (
        <p role="alert" className="text-text-destructive text-sm">
          {localize('com_admin_status_refresh_error')}
        </p>
      )}

      {status.isLoading && (
        <div
          className="grid gap-3 md:grid-cols-2 lg:grid-cols-3"
          aria-busy="true"
          aria-label={localize('com_admin_status_title')}
          data-testid="status-loading"
        >
          {Array.from({ length: SKELETON_CARDS }, (_, index) => (
            <div key={index} className="border-border-light space-y-3 rounded-xl border p-4">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-2 w-full" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      )}

      {status.isError && data == null && (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <p className="text-text-destructive text-sm">{localize('com_admin_status_load_error')}</p>
          <Button size="compact" variant="outline" onClick={() => status.refetch()}>
            {localize('com_admin_status_retry')}
          </Button>
        </div>
      )}

      {data != null && data.services.length === 0 && (
        <EmptyState
          icon={Activity}
          description={localize('com_admin_status_empty')}
          action={refreshButton}
        />
      )}

      {data != null && data.services.length > 0 && (
        <>
          <ChainSummary chain={data.chain} active={data.activeSearchProvider} locale={locale} />
          <section
            aria-label={localize('com_admin_status_title')}
            className="grid gap-3 md:grid-cols-2 lg:grid-cols-3"
          >
            {data.services.map((service) => (
              <ServiceCard
                key={service.id}
                service={service}
                locale={locale}
                now={now}
                currency={currency}
                isActive={service.id === data.activeSearchProvider}
              />
            ))}
          </section>
        </>
      )}
    </div>
  );
}
