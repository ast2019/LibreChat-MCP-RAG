import { Progress } from '@librechat/client';
import type { TServiceStatus, TServiceHealth } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks/useLocalize';
import type { CurrencyConfig } from '~/utils';
import {
  HEALTH_KEYS,
  SERVICE_NAME_KEYS,
  formatDate,
  formatAmount,
  formatNumber,
  formatPercent,
  formatRelative,
  formatDateTime,
} from './format';
import { useLocalize } from '~/hooks';
import Models from './Models';
import { cn } from '~/utils';

const PILL: Record<TServiceHealth, { box: string; dot: string }> = {
  ok: {
    box: 'border-status-success-border bg-status-success-subtle',
    dot: 'bg-status-success-strong',
  },
  warning: {
    box: 'border-status-warning-border bg-status-warning-subtle',
    dot: 'bg-status-warning-strong',
  },
  exhausted: {
    box: 'border-status-error-border bg-status-error-subtle',
    dot: 'bg-status-error-strong',
  },
  error: {
    box: 'border-status-error-border bg-status-error-subtle',
    dot: 'bg-status-error-strong',
  },
  unconfigured: {
    box: 'border-status-neutral-border bg-status-neutral-subtle',
    dot: 'bg-status-neutral',
  },
};

const SKIP_KEYS: Record<NonNullable<TServiceStatus['skip']>['reason'], TranslationKeys> = {
  exhausted: 'com_admin_status_skip_exhausted',
  rate_limited: 'com_admin_status_skip_rate_limited',
  unauthorized: 'com_admin_status_skip_unauthorized',
};

export function HealthPill({ health }: { health: TServiceHealth }) {
  const localize = useLocalize();
  const style = PILL[health];
  return (
    <span
      className={cn(
        'text-text-primary inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium',
        style.box,
      )}
      data-testid={`health-${health}`}
    >
      <span className={cn('size-2 rounded-full', style.dot)} aria-hidden="true" />
      {localize(HEALTH_KEYS[health])}
    </span>
  );
}

export default function ServiceCard({
  service,
  locale,
  now,
  currency,
  isActive,
}: {
  service: TServiceStatus;
  locale: string;
  now: number;
  currency?: CurrencyConfig;
  isActive: boolean;
}) {
  const localize = useLocalize();
  const name = localize(SERVICE_NAME_KEYS[service.id]);
  const titleId = `service-${service.id}`;
  const amount = (value: number) =>
    formatAmount(value, service.unit, { locale, currency, localize });
  const flagged = service.health === 'warning';
  const failed = service.health === 'exhausted' || service.health === 'error';
  let tone: { border: string; bar: 'error' | 'warning' | 'default' } = {
    border: 'border-border-light',
    bar: 'default',
  };
  if (failed) {
    tone = { border: 'border-status-error-border', bar: 'error' };
  } else if (flagged) {
    tone = { border: 'border-status-warning-border', bar: 'warning' };
  }

  let remainingLine: string | null = null;
  if (service.remaining != null) {
    remainingLine =
      service.limit != null
        ? localize('com_admin_status_remaining_of', {
            0: amount(service.remaining),
            1: amount(service.limit),
          })
        : localize('com_admin_status_remaining', { 0: amount(service.remaining) });
  } else if (service.configured && service.unit != null) {
    remainingLine = localize('com_admin_status_remaining_unknown');
  }

  return (
    <article
      aria-labelledby={titleId}
      data-testid={`service-card-${service.id}`}
      className={cn('bg-surface-secondary flex flex-col gap-3 rounded-xl border p-4', tone.border)}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={titleId} className="text-text-primary text-sm font-semibold">
            {name}
          </h3>
          {service.chainPosition != null && (
            <p className="text-text-secondary mt-0.5 text-xs">
              {localize('com_admin_status_chain_position', {
                0: formatNumber(service.chainPosition, locale),
              })}
              {isActive && (
                <span className="border-status-info-border bg-status-info-subtle text-text-primary ms-2 rounded-full border px-1.5 py-px">
                  {localize('com_admin_status_active_badge')}
                </span>
              )}
            </p>
          )}
        </div>
        <HealthPill health={service.health} />
      </header>

      {remainingLine != null && (
        <div className="space-y-1.5">
          <p className="text-text-primary text-sm">{remainingLine}</p>
          {service.remainingPercent != null && (
            <div className="flex items-center gap-2">
              <Progress
                value={service.remainingPercent}
                aria-label={localize('com_admin_status_progress_label', { 0: name })}
                variant={tone.bar}
                className="flex-1"
              />
              <span className="text-text-secondary w-10 text-end text-xs">
                {formatPercent(service.remainingPercent, locale)}
              </span>
            </div>
          )}
        </div>
      )}

      <ul className="text-text-secondary space-y-1 text-xs">
        {service.daysUntilExhausted != null && (
          <li className={cn(flagged || failed ? 'text-text-primary font-medium' : undefined)}>
            {localize('com_admin_status_days_left', {
              0: formatNumber(Math.max(0, Math.floor(service.daysUntilExhausted)), locale),
            })}
          </li>
        )}
        {service.usedThisPeriod != null && (
          <li>{localize('com_admin_status_used', { 0: amount(service.usedThisPeriod) })}</li>
        )}
        {service.resetAt != null && (
          <li>{localize('com_admin_status_reset', { 0: formatDate(service.resetAt, locale) })}</li>
        )}
        {service.plan != null && (
          <li>
            {localize('com_admin_status_plan_label')} <bdi>{service.plan}</bdi>
          </li>
        )}
        {service.unit == null && service.reachable != null && (
          <li>
            {localize(
              service.reachable ? 'com_admin_status_reachable' : 'com_admin_status_unreachable',
            )}
          </li>
        )}
        {service.skip != null && (
          <li className="text-text-primary">
            {localize(SKIP_KEYS[service.skip.reason], {
              0: formatDateTime(service.skip.until, locale),
            })}
          </li>
        )}
        {service.details?.map((gateway) => (
          <li key={gateway.name}>
            {localize(
              gateway.healthy ? 'com_admin_status_gateway_ok' : 'com_admin_status_gateway_down',
              {
                0: gateway.name,
              },
            )}
          </li>
        ))}
        {service.errorCode != null && (
          <li>
            {localize('com_admin_status_error_label')}{' '}
            <code dir="ltr" className="font-mono">
              {service.errorCode}
            </code>
          </li>
        )}
      </ul>

      {service.models != null && (
        <Models
          models={service.models}
          loadedKnown={service.loadedKnown !== false}
          locale={locale}
          now={now}
          titleId={`${titleId}-models`}
        />
      )}

      <footer className="text-text-tertiary mt-auto text-xs">
        {service.checkedAt != null ? (
          <time dateTime={service.checkedAt} title={formatDateTime(service.checkedAt, locale)}>
            {localize('com_admin_status_checked', {
              0: formatRelative(service.checkedAt, now, locale),
            })}
          </time>
        ) : (
          localize('com_admin_status_never_checked')
        )}
      </footer>
    </article>
  );
}
