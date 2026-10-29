import { useState } from 'react';
import { Button, OGDialog, OGDialogTemplate, Progress, Skeleton } from '@librechat/client';
import type { TAdminBillingUser } from 'librechat-data-provider';
import type { CurrencyConfig } from '~/utils';
import type { TranslationKeys } from '~/hooks';
import { useAdminBillingUserUsageQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';
import { Money } from './parts';

const WINDOWS = [7, 30, 90] as const;

/** Ledger contexts admins see, in plain words; anything else shows its raw name. */
const CONTEXT_LABELS: Record<string, TranslationKeys> = {
  message: 'com_admin_spend_message',
  memory: 'com_admin_spend_memory',
  title: 'com_admin_spend_title',
  summarization: 'com_admin_spend_summarization',
  ocr: 'com_admin_spend_ocr',
  ocr_local: 'com_admin_spend_ocr_local',
  stt: 'com_admin_spend_stt',
  tts: 'com_admin_spend_tts',
  image_generation: 'com_admin_spend_image',
  subagent: 'com_admin_spend_subagent',
  reasoning: 'com_admin_spend_reasoning',
  other: 'com_admin_spend_misc',
};

/** One user's spend in the last 7, 30 or 90 days, split by what it paid for and by model. */
export default function UsageDialog({
  user,
  currency,
  onClose,
}: {
  user: TAdminBillingUser;
  currency?: CurrencyConfig;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const [days, setDays] = useState<number>(30);
  const { data, isLoading, isError } = useAdminBillingUserUsageQuery(user.id, days);
  const total = data?.totalCredits ?? 0;
  const share = (credits: number) => (total > 0 ? Math.round((credits / total) * 100) : 0);
  const label = (context: string) =>
    CONTEXT_LABELS[context] != null ? localize(CONTEXT_LABELS[context]) : context;

  let body: React.ReactNode;
  if (isLoading) {
    body = (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  } else if (isError || !data) {
    body = (
      <p role="alert" className="text-text-destructive text-sm">
        {localize('com_admin_load_error')}
      </p>
    );
  } else if (data.byContext.length === 0) {
    body = <p className="text-text-secondary text-sm">{localize('com_admin_spend_none')}</p>;
  } else {
    body = (
      <div className="space-y-4">
        <p className="text-text-primary text-sm">
          {localize('com_admin_spend_total')}{' '}
          <span className="font-semibold">
            <Money credits={total} currency={currency} />
          </span>
        </p>
        <table className="w-full text-sm" data-testid="usage-by-context">
          <thead className="text-text-secondary text-xs">
            <tr>
              <th className="py-1 text-start font-medium">{localize('com_admin_spend_kind')}</th>
              <th className="py-1 text-end font-medium">{localize('com_admin_spend_calls')}</th>
              <th className="py-1 text-end font-medium">{localize('com_admin_spend_amount')}</th>
            </tr>
          </thead>
          <tbody>
            {data.byContext.map((row) => (
              <tr key={row.context} className="border-border-light border-t">
                <td className="py-2">
                  <span className="text-text-primary">{label(row.context)}</span>
                  <Progress
                    aria-hidden="true"
                    value={share(row.credits)}
                    className="mt-1 h-1.5"
                  />
                </td>
                <td className="text-text-secondary py-2 text-end tabular-nums">{row.count}</td>
                <td className="text-text-primary py-2 text-end">
                  <Money credits={row.credits} currency={currency} />
                  <span className="text-text-secondary block text-xs">{share(row.credits)}%</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.byModel.length > 0 && (
          <div>
            <h3 className="text-text-secondary mb-1 text-xs font-medium">
              {localize('com_admin_spend_by_model')}
            </h3>
            <ul className="space-y-1 text-sm">
              {data.byModel.map((row) => (
                <li key={row.model} className="flex items-start justify-between gap-3">
                  <span dir="ltr" className="text-text-primary truncate">
                    {row.model}
                  </span>
                  <span className="text-end">
                    <Money credits={row.credits} currency={currency} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <OGDialog open onOpenChange={(open) => !open && onClose()}>
      <OGDialogTemplate
        title={localize('com_admin_spend_heading')}
        description={[user.name || user.username, user.email || user.phone]
          .filter(Boolean)
          .join(' · ')}
        className="w-11/12 md:max-w-lg"
        main={
          <div className="space-y-4">
            <div role="group" aria-label={localize('com_admin_window')} className="flex gap-2">
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
            {body}
          </div>
        }
      />
    </OGDialog>
  );
}
