import { useState } from 'react';
import { Check, Copy, Gift, Share2 } from 'lucide-react';
import { Button, Skeleton } from '@librechat/client';
import { useGetStartupConfig, useReferralQuery } from '~/data-provider';
import { formatBalanceAmount } from '~/utils';
import { useLocalize } from '~/hooks';

/** The user's invite link, what each invite pays and what it has earned so far. */
export default function InviteCard() {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();
  const enabled = startupConfig?.referral?.enabled === true;
  const { data: info, isLoading, isError } = useReferralQuery(enabled);
  const [copied, setCopied] = useState(false);
  const currency = startupConfig?.interface?.currency;
  const money = (credits: number) => formatBalanceAmount(credits, 'currency', currency);

  if (!enabled) {
    return null;
  }
  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }
  if (isError || !info) {
    return (
      <div className="text-text-destructive text-sm" role="alert">
        {localize('com_ui_referral_error')}
      </div>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(info.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const share = () =>
    navigator
      .share({ title: localize('com_ui_referral_share_title'), url: info.link })
      .catch(() => undefined);
  const remaining = Math.max(info.maxRewards - info.rewarded, 0);

  return (
    <div className="flex flex-col gap-3 text-sm" data-testid="invite-card">
      <div className="flex items-start gap-3">
        <span className="bg-series-4/15 text-series-4 flex size-9 shrink-0 items-center justify-center rounded-full">
          <Gift className="size-5" aria-hidden="true" />
        </span>
        <p className="text-text-primary">
          {localize('com_ui_referral_offer', {
            0: money(info.referrerCredits),
            1: money(info.inviteeCredits),
          })}
          {info.requirePhone && (
            <span className="text-text-secondary block text-xs">
              {localize('com_ui_referral_phone_rule')}
            </span>
          )}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <input
          readOnly
          dir="ltr"
          value={info.link}
          aria-label={localize('com_ui_referral_link')}
          onFocus={(event) => event.currentTarget.select()}
          className="border-border-medium bg-surface-secondary text-text-primary h-9 min-w-0 flex-1 rounded-lg border px-3 text-xs"
          data-testid="invite-link"
        />
        <Button size="sm" onClick={copy} aria-live="polite" data-testid="invite-copy">
          {copied ? (
            <Check className="size-4" aria-hidden="true" />
          ) : (
            <Copy className="size-4" aria-hidden="true" />
          )}
          {localize(copied ? 'com_ui_copied' : 'com_ui_copy')}
        </Button>
        {canShare && (
          <Button size="sm" variant="outline" onClick={share} aria-label={localize('com_ui_share')}>
            <Share2 className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>
      <dl className="text-text-secondary grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt>{localize('com_ui_referral_invited')}</dt>
          <dd className="text-text-primary text-base font-semibold">{info.invited}</dd>
        </div>
        <div>
          <dt>{localize('com_ui_referral_rewarded')}</dt>
          <dd className="text-text-primary text-base font-semibold">{info.rewarded}</dd>
        </div>
        <div>
          <dt>{localize('com_ui_referral_earned')}</dt>
          <dd className="text-text-primary text-base font-semibold">{money(info.earnedCredits)}</dd>
        </div>
      </dl>
      {remaining === 0 && (
        <p className="text-text-secondary text-xs">{localize('com_ui_referral_cap_reached')}</p>
      )}
    </div>
  );
}
