import { useState } from 'react';
import {
  Input,
  Label,
  Button,
  Spinner,
  OGDialog,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import type { TAdminBillingPack, TAdminBillingUser } from 'librechat-data-provider';
import type { CurrencyConfig } from '~/utils';
import { useAdminBillingGrantMutation } from '~/data-provider';
import { formatPackPrice } from '~/utils/balance';
import { useLocalize } from '~/hooks';
import { formatUsd } from './format';
import { cn } from '~/utils';

const CUSTOM = 'custom';

export default function GrantDialog({
  user,
  packs,
  currency,
  onClose,
}: {
  user: TAdminBillingUser | null;
  packs: TAdminBillingPack[];
  /** Display currency; pack sale prices are shown in it beside the dollar value */
  currency?: CurrencyConfig;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const grant = useAdminBillingGrantMutation();
  const [choice, setChoice] = useState<string>(packs[0]?.id ?? CUSTOM);
  const [usd, setUsd] = useState('');

  const customCredits = Math.round(Number.parseFloat(usd) * 1_000_000);
  const customValid = Number.isFinite(customCredits) && customCredits > 0;
  const canSubmit = user != null && !grant.isLoading && (choice !== CUSTOM || customValid);

  const submit = () => {
    if (user == null || !canSubmit) {
      return;
    }
    const payload =
      choice === CUSTOM
        ? { userId: user.id, credits: customCredits }
        : { userId: user.id, packId: choice };
    grant.mutate(payload, {
      onSuccess: () => {
        showToast({ status: 'success', message: localize('com_admin_grant_success') });
        onClose();
      },
      onError: () => {
        showToast({ status: 'error', message: localize('com_admin_grant_error') });
      },
    });
  };

  return (
    <OGDialog open={user != null} onOpenChange={(open) => !open && onClose()}>
      <OGDialogTemplate
        title={localize('com_admin_grant_title')}
        description={user ? `${user.name || user.username} · ${user.email}` : undefined}
        className="w-11/12 md:max-w-lg"
        showCloseButton={false}
        main={
          <fieldset className="space-y-2">
            <legend className="text-text-secondary mb-2 text-sm">
              {localize('com_admin_grant_choose')}
            </legend>
            {[...packs, null].map((pack) => {
              const id = pack?.id ?? CUSTOM;
              return (
                <label
                  key={id}
                  className={cn(
                    'border-border-light hover:bg-surface-hover flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2',
                    choice === id && 'border-border-heavy bg-surface-secondary',
                  )}
                >
                  <input
                    type="radio"
                    name="grant-choice"
                    value={id}
                    checked={choice === id}
                    onChange={() => setChoice(id)}
                  />
                  <span className="text-text-primary flex-1 text-sm">
                    {pack ? pack.label : localize('com_admin_grant_custom')}
                  </span>
                  {pack && (
                    <span className="text-text-secondary text-end text-xs">
                      {formatUsd(pack.credits)}
                      {currency != null && currency.code.toUpperCase() !== 'USD' && (
                        <span className="block">{formatPackPrice(pack.credits, currency)}</span>
                      )}
                    </span>
                  )}
                </label>
              );
            })}
            {choice === CUSTOM && (
              <div className="space-y-1 pt-1">
                <Label htmlFor="grant-usd">{localize('com_admin_grant_custom_usd')}</Label>
                <Input
                  id="grant-usd"
                  inputMode="decimal"
                  value={usd}
                  onChange={(event) => setUsd(event.target.value)}
                  placeholder="2.5"
                />
              </div>
            )}
          </fieldset>
        }
        buttons={
          <Button onClick={submit} disabled={!canSubmit} aria-busy={grant.isLoading}>
            {grant.isLoading ? <Spinner className="size-4" /> : localize('com_admin_grant_submit')}
          </Button>
        }
      />
    </OGDialog>
  );
}
