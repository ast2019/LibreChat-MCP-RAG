import { useEffect, useId, useState } from 'react';
import { Gift } from 'lucide-react';
import { CREDITS_PER_USD } from 'librechat-data-provider';
import {
  Input,
  Label,
  Button,
  Switch,
  Spinner,
  Skeleton,
  useToastContext,
} from '@librechat/client';
import type { TAdminGiftSettings, TAdminGiftUpdate } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { useAdminGiftsQuery, useAdminGiftsMutation } from '~/data-provider';
import { useBalanceDisplay } from '~/hooks/useBalanceSummary';
import { formatLocal } from './format';
import { useLocalize } from '~/hooks';

type Draft = {
  startBalance: string;
  referrerCredits: string;
  inviteeCredits: string;
  maxRewardsPerReferrer: string;
  enabled: boolean;
};

const toUsd = (credits: number) => String(Math.round((credits / CREDITS_PER_USD) * 100) / 100);

function toDraft(settings: TAdminGiftSettings): Draft {
  return {
    startBalance: toUsd(settings.startBalance),
    referrerCredits: toUsd(settings.referral.referrerCredits),
    inviteeCredits: toUsd(settings.referral.inviteeCredits),
    maxRewardsPerReferrer: String(settings.referral.maxRewardsPerReferrer),
    enabled: settings.referral.enabled,
  };
}

/** Dollars typed by the admin as whole credits; null when not a valid amount. */
function toCredits(usd: string): number | null {
  const value = Number.parseFloat(usd.trim());
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    return null;
  }
  return Math.round(value * CREDITS_PER_USD);
}

function MoneyField({
  label,
  hint,
  value,
  onChange,
  invalid,
}: {
  label: TranslationKeys;
  hint: TranslationKeys;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
}) {
  const localize = useLocalize();
  const { currency } = useBalanceDisplay();
  const id = useId();
  const credits = toCredits(value);
  const local = credits != null ? formatLocal(credits, currency) : null;
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{localize(label)}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          dir="ltr"
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={invalid}
          aria-describedby={`${id}-hint`}
          className="max-w-32"
        />
        <span className="text-text-secondary text-sm">$</span>
        {local != null && <span className="text-text-secondary text-sm">≈ {local}</span>}
      </div>
      <p id={`${id}-hint`} className="text-text-secondary text-xs">
        {localize(hint)}
      </p>
    </div>
  );
}

/** The sign-up gift and invite rewards, set by the admin; new values apply from now on. */
export default function Gifts() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const gifts = useAdminGiftsQuery();
  const save = useAdminGiftsMutation();
  const [draft, setDraft] = useState<Draft | null>(null);
  const rewardsId = useId();

  useEffect(() => {
    if (gifts.data && draft == null) {
      setDraft(toDraft(gifts.data));
    }
  }, [gifts.data, draft]);

  if (gifts.isError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-text-destructive text-sm">
          {localize('com_admin_load_error')}
        </p>
        <Button size="sm" variant="outline" onClick={() => void gifts.refetch()}>
          {localize('com_ui_retry')}
        </Button>
      </div>
    );
  }
  if (draft == null) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  const startCredits = toCredits(draft.startBalance);
  const referrerCredits = toCredits(draft.referrerCredits);
  const inviteeCredits = toCredits(draft.inviteeCredits);
  const maxRewards = Number.parseInt(draft.maxRewardsPerReferrer, 10);
  const maxValid = Number.isInteger(maxRewards) && maxRewards >= 0 && maxRewards <= 10_000;
  const valid =
    startCredits != null && referrerCredits != null && inviteeCredits != null && maxValid;

  const submit = () => {
    if (!valid) {
      return;
    }
    const payload: TAdminGiftUpdate = {
      startBalance: startCredits,
      referral: {
        enabled: draft.enabled,
        referrerCredits,
        inviteeCredits,
        maxRewardsPerReferrer: maxRewards,
      },
    };
    save.mutate(payload, {
      onSuccess: (data) => {
        setDraft(toDraft(data));
        showToast({ status: 'success', message: localize('com_admin_gifts_saved') });
      },
      onError: () => showToast({ status: 'error', message: localize('com_admin_save_error') }),
    });
  };

  const set = (key: keyof Draft) => (value: string) => setDraft({ ...draft, [key]: value });
  const changedAt = gifts.data?.changedAt
    ? new Date(gifts.data.changedAt).toLocaleString(document.documentElement.lang || undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : null;

  return (
    <section aria-labelledby="admin-gifts" className="max-w-2xl space-y-4">
      <div className="flex items-start gap-3">
        <Gift className="text-text-secondary mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div>
          <h2 id="admin-gifts" className="text-text-primary text-base font-semibold">
            {localize('com_admin_gifts_title')}
          </h2>
          <p className="text-text-secondary text-sm">{localize('com_admin_gifts_intro')}</p>
          {changedAt && (
            <p className="text-text-tertiary mt-1 text-xs">
              {localize('com_admin_gifts_changed_at', { 0: changedAt })}
            </p>
          )}
        </div>
      </div>

      <div className="border-border-light space-y-4 rounded-xl border p-4">
        <MoneyField
          label="com_admin_gifts_start"
          hint="com_admin_gifts_start_hint"
          value={draft.startBalance}
          onChange={set('startBalance')}
          invalid={startCredits == null}
        />
      </div>

      <div className="border-border-light space-y-4 rounded-xl border p-4">
        <div className="flex items-center justify-between gap-3">
          <Label id={rewardsId}>{localize('com_admin_gifts_referral')}</Label>
          <Switch
            aria-labelledby={rewardsId}
            checked={draft.enabled}
            onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
          />
        </div>
        <MoneyField
          label="com_admin_gifts_referrer"
          hint="com_admin_gifts_referrer_hint"
          value={draft.referrerCredits}
          onChange={set('referrerCredits')}
          invalid={referrerCredits == null}
        />
        <MoneyField
          label="com_admin_gifts_invitee"
          hint="com_admin_gifts_invitee_hint"
          value={draft.inviteeCredits}
          onChange={set('inviteeCredits')}
          invalid={inviteeCredits == null}
        />
        <div className="space-y-1">
          <Label htmlFor="gift-max-rewards">{localize('com_admin_gifts_max')}</Label>
          <Input
            id="gift-max-rewards"
            dir="ltr"
            inputMode="numeric"
            value={draft.maxRewardsPerReferrer}
            onChange={(event) => set('maxRewardsPerReferrer')(event.target.value)}
            aria-invalid={!maxValid}
            className="max-w-32"
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={submit} disabled={!valid || save.isLoading} aria-busy={save.isLoading}>
          {save.isLoading ? <Spinner className="size-4" /> : localize('com_ui_save')}
        </Button>
        {!valid && (
          <span role="alert" className="text-text-destructive text-xs">
            {localize('com_admin_gifts_invalid')}
          </span>
        )}
      </div>
    </section>
  );
}
