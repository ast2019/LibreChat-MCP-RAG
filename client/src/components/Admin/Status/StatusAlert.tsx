import { Button } from '@librechat/client';
import { useTranslation } from 'react-i18next';
import { SERVICE_NAME_KEYS, formatNumber, getAttention } from './format';
import { useAdminServiceStatusQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';

/**
 * A one-line notice on the admin overview when a service is out of credit, failing or running
 * low. Renders nothing while loading, on error, or when everything is fine: the status tab owns
 * those states.
 */
export default function StatusAlert({ onOpen }: { onOpen: () => void }) {
  const localize = useLocalize();
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'fa';
  const { data } = useAdminServiceStatusQuery();
  if (data == null) {
    return null;
  }
  const { exhausted, low } = getAttention(data.services);
  if (exhausted.length === 0 && low.length === 0) {
    return null;
  }
  const list = new Intl.ListFormat(locale, { type: 'conjunction' });
  const names = (rows: typeof exhausted) =>
    list.format(rows.map((row) => localize(SERVICE_NAME_KEYS[row.id])));
  const severe = exhausted.length > 0;

  return (
    <section
      aria-live="polite"
      data-testid="status-alert"
      className={
        severe
          ? 'border-status-error-border bg-status-error-subtle flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3'
          : 'border-status-warning-border bg-status-warning-subtle flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3'
      }
    >
      <div className="text-text-primary min-w-0 flex-1 space-y-0.5 text-sm">
        <p className="font-medium">
          {localize('com_admin_status_alert', {
            0: formatNumber(exhausted.length + low.length, locale),
          })}
        </p>
        {exhausted.length > 0 && (
          <p>{localize('com_admin_status_alert_exhausted', { 0: names(exhausted) })}</p>
        )}
        {low.length > 0 && <p>{localize('com_admin_status_alert_low', { 0: names(low) })}</p>}
      </div>
      <Button size="compact" variant="outline" onClick={onOpen}>
        {localize('com_admin_status_alert_view')}
      </Button>
    </section>
  );
}
