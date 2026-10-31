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
import { useAdminBillingBulkGrantMutation, useAdminBillingGrantMutation } from '~/data-provider';
import { describePackGrants } from './accessLabels';
import { formatCount, formatList } from './format';
import { formatPackPrice } from '~/utils/balance';
import { useLocalize } from '~/hooks';
import { formatUsd } from './format';
import { cn } from '~/utils';

const CUSTOM = 'custom';

/** What a pack grants and withholds, in one line under its name; nothing when it says nothing. */
function PackGrantsLine({ pack }: { pack: TAdminBillingPack }) {
  const localize = useLocalize();
  const { granted, withheld } = describePackGrants(localize, pack);
  if (granted.length === 0 && withheld.length === 0) {
    return null;
  }
  return (
    <span className="text-text-secondary block text-xs">
      {granted.length > 0 && localize('com_admin_pack_grants', { 0: formatList(granted) })}
      {granted.length > 0 && withheld.length > 0 && ' · '}
      {withheld.length > 0 && localize('com_admin_pack_withholds', { 0: formatList(withheld) })}
    </span>
  );
}

/**
 * Adds a pack or a dollar amount of credit to one user, or (with `userIds`) to every selected
 * user. Each pack lists the access it grants and withholds, so the admin sees what the user gets.
 */
export default function GrantDialog({
  user,
  userIds,
  packs,
  currency,
  onClose,
  onDone,
}: {
  user: TAdminBillingUser | null;
  /** Several users at once; takes the place of `user` */
  userIds?: string[];
  packs: TAdminBillingPack[];
  /** Display currency; pack sale prices are shown in it beside the dollar value */
  currency?: CurrencyConfig;
  onClose: () => void;
  /** Called after a bulk grant answered, so the page can clear its selection */
  onDone?: () => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const single = useAdminBillingGrantMutation();
  const bulk = useAdminBillingBulkGrantMutation();
  const isBulk = userIds != null && userIds.length > 0;
  const grant = isBulk ? bulk : single;
  const [choice, setChoice] = useState<string>(packs[0]?.id ?? CUSTOM);
  const [usd, setUsd] = useState('');

  const customCredits = Math.round(Number.parseFloat(usd) * 1_000_000);
  const customValid = Number.isFinite(customCredits) && customCredits > 0;
  const canSubmit =
    (user != null || isBulk) && !grant.isLoading && (choice !== CUSTOM || customValid);
  const amount = choice === CUSTOM ? { credits: customCredits } : { packId: choice };

  const onError = () => {
    showToast({ status: 'error', message: localize('com_admin_grant_error') });
  };

  const submit = () => {
    if (!canSubmit) {
      return;
    }
    if (isBulk) {
      bulk.mutate(
        { userIds, ...amount },
        {
          onSuccess: (data) => {
            showToast({
              status: data.failed.length > 0 ? 'warning' : 'success',
              message: localize('com_admin_bulk_grant_done', {
                0: formatCount(data.granted),
                1: formatCount(data.failed.length),
              }),
            });
            onDone?.();
            onClose();
          },
          onError,
        },
      );
      return;
    }
    if (user == null) {
      return;
    }
    single.mutate(
      { userId: user.id, ...amount },
      {
        onSuccess: () => {
          showToast({ status: 'success', message: localize('com_admin_grant_success') });
          onClose();
        },
        onError,
      },
    );
  };

  let description: string | undefined;
  if (isBulk) {
    description = localize('com_admin_bulk_selected', { 0: formatCount(userIds.length) });
  } else if (user) {
    description = `${user.name || user.username} · ${user.email}`;
  }

  return (
    <OGDialog open={user != null || isBulk} onOpenChange={(open) => !open && onClose()}>
      <OGDialogTemplate
        title={localize('com_admin_grant_title')}
        description={description}
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
                  <span className="flex-1">
                    <span className="text-text-primary block text-sm">
                      {pack ? pack.label : localize('com_admin_grant_custom')}
                    </span>
                    {pack && <PackGrantsLine pack={pack} />}
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
