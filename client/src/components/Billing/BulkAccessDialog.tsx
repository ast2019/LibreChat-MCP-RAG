import { useState } from 'react';
import { ACCESS_CLASSES } from 'librechat-data-provider';
import { Button, Spinner, OGDialog, OGDialogTemplate, useToastContext } from '@librechat/client';
import type { TAccessClass } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { useAdminUsersBulkAccessMutation } from '~/data-provider';
import { ACCESS_LABELS } from './accessLabels';
import { formatCount } from './format';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type Choice = 'default' | 'allow' | 'deny';

const CHOICES: { value: Choice; label: TranslationKeys }[] = [
  { value: 'allow', label: 'com_admin_model_access_allow' },
  { value: 'deny', label: 'com_admin_model_access_deny' },
  { value: 'default', label: 'com_admin_bulk_access_default' },
];

const optionClass = (selected: boolean) =>
  cn(
    'border-border-light hover:bg-surface-hover flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm',
    selected && 'border-border-heavy bg-surface-secondary',
  );

/** Sets one access class to on, off or default for every selected user. */
export default function BulkAccessDialog({
  userIds,
  onClose,
  onDone,
}: {
  userIds: string[];
  onClose: () => void;
  /** Called after the server answered, so the page can clear its selection */
  onDone: () => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const bulk = useAdminUsersBulkAccessMutation();
  const [field, setField] = useState<TAccessClass>('media');
  const [choice, setChoice] = useState<Choice>('allow');

  const submit = () => {
    const value = choice === 'default' ? null : choice === 'allow';
    bulk.mutate(
      { userIds, field, value },
      {
        onSuccess: (data) => {
          showToast({
            status: data.notFound.length > 0 ? 'warning' : 'success',
            message: localize('com_admin_bulk_access_done', { 0: formatCount(data.updated) }),
          });
          onDone();
          onClose();
        },
        onError: () => showToast({ status: 'error', message: localize('com_admin_save_error') }),
      },
    );
  };

  return (
    <OGDialog open onOpenChange={(open) => !open && onClose()}>
      <OGDialogTemplate
        title={localize('com_admin_bulk_access')}
        description={localize('com_admin_bulk_selected', { 0: formatCount(userIds.length) })}
        className="w-11/12 md:max-w-lg"
        showCloseButton={false}
        main={
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-text-secondary mb-2 text-sm">
                {localize('com_admin_bulk_access_which')}
              </legend>
              {ACCESS_CLASSES.map((item) => (
                <label key={item} className={optionClass(field === item)}>
                  <input
                    type="radio"
                    name="bulk-access-field"
                    value={item}
                    checked={field === item}
                    onChange={() => setField(item)}
                  />
                  <span className="text-text-primary">{localize(ACCESS_LABELS[item].full)}</span>
                </label>
              ))}
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="text-text-secondary mb-2 text-sm">
                {localize('com_admin_bulk_access_to')}
              </legend>
              {CHOICES.map((item) => (
                <label key={item.value} className={optionClass(choice === item.value)}>
                  <input
                    type="radio"
                    name="bulk-access-value"
                    value={item.value}
                    checked={choice === item.value}
                    onChange={() => setChoice(item.value)}
                  />
                  <span className="text-text-primary">{localize(item.label)}</span>
                </label>
              ))}
            </fieldset>
          </div>
        }
        buttons={
          <Button onClick={submit} disabled={bulk.isLoading} aria-busy={bulk.isLoading}>
            {bulk.isLoading ? <Spinner className="size-4" /> : localize('com_admin_bulk_apply')}
          </Button>
        }
      />
    </OGDialog>
  );
}
