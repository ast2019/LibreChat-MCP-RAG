import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import {
  Button,
  Skeleton,
  OGDialog,
  FilterInput,
  OGDialogTitle,
  OGDialogHeader,
  OGDialogContent,
  OGDialogDescription,
} from '@librechat/client';
import type { TMediaImageModel } from 'librechat-data-provider';
import { useBalanceDisplay } from '~/hooks/useBalanceSummary';
import { useMediaStatusQuery } from '~/data-provider';
import { formatCost } from '~/utils/tokens';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/** Matches the words the user typed against the model's id and name, in any order. */
export function filterImageModels(
  models: readonly TMediaImageModel[],
  query: string,
): TMediaImageModel[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return [...models];
  }
  return models.filter((model) => {
    const haystack = `${model.id} ${model.name ?? ''} ${model.persianText ? 'persian فارسی' : ''}`
      .toLowerCase()
      .replace(/[-_/]/g, ' ');
    return terms.every((term) => haystack.includes(term));
  });
}

function ModelRow({
  model,
  selected,
  price,
  onPick,
}: {
  model: TMediaImageModel;
  selected: boolean;
  price: string;
  onPick: (id: string) => void;
}) {
  const localize = useLocalize();
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={selected}
        onClick={() => onPick(model.id)}
        className={cn(
          'hover:bg-surface-hover focus-visible:bg-surface-hover flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start focus-visible:outline-hidden',
          selected && 'bg-surface-active-alt',
        )}
        data-testid={`image-model-${model.id}`}
      >
        <span className="min-w-0 flex-1">
          <span className="text-text-primary flex flex-wrap items-center gap-2 text-sm font-medium">
            <bdi>{model.name ?? model.id}</bdi>
            {model.persianText && (
              <span className="border-border-light text-text-secondary rounded-full border px-2 text-xs">
                {localize('com_media_image_model_persian')}
              </span>
            )}
            {model.default === true && (
              <span className="text-text-tertiary text-xs">
                {localize('com_media_image_model_default')}
              </span>
            )}
          </span>
          <span className="text-text-tertiary block truncate text-xs" dir="ltr">
            {model.id}
          </span>
        </span>
        <span className="text-text-secondary shrink-0 text-xs">
          {localize('com_media_image_model_price', { 0: price })}
        </span>
        <Check
          className={cn('size-4 shrink-0', selected ? 'text-text-primary' : 'invisible')}
          aria-hidden="true"
        />
      </button>
    </li>
  );
}

/**
 * Picks the image model for this chat: search by name, maker or «فارسی», the models suggested
 * for Persian text first, each with what one picture holds from the user's credit.
 */
export default function ImageModelDialog({
  open,
  onOpenChange,
  current,
  onPick,
  triggerRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The model the next picture uses */
  current?: string;
  onPick: (modelId: string) => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
}) {
  const localize = useLocalize();
  const { currency } = useBalanceDisplay();
  const status = useMediaStatusQuery(open);
  const [query, setQuery] = useState('');
  const models = useMemo(() => status.data?.imageModels ?? [], [status.data?.imageModels]);
  const shown = useMemo(() => filterImageModels(models, query), [models, query]);
  const persian = shown.filter((model) => model.persianText);
  const others = shown.filter((model) => !model.persianText);

  const pick = (modelId: string) => {
    onPick(modelId);
    onOpenChange(false);
  };
  const row = (model: TMediaImageModel) => (
    <ModelRow
      key={model.id}
      model={model}
      selected={model.id === current}
      price={formatCost(model.estimateUsd, currency)}
      onPick={pick}
    />
  );

  return (
    <OGDialog open={open} onOpenChange={onOpenChange} triggerRef={triggerRef}>
      <OGDialogContent className="flex max-h-[90vh] w-11/12 max-w-xl flex-col gap-3">
        <OGDialogHeader>
          <OGDialogTitle>{localize('com_media_image_model_title')}</OGDialogTitle>
          <OGDialogDescription>{localize('com_media_image_model_intro')}</OGDialogDescription>
        </OGDialogHeader>
        <FilterInput
          inputId="image-model-search"
          label={localize('com_media_image_model_search')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          surface="dialog"
        />
        {status.isLoading && (
          <div className="space-y-2" aria-hidden="true">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        )}
        {status.isError && (
          <div className="flex flex-col items-start gap-2">
            <p role="alert" className="text-text-destructive text-sm">
              {localize('com_media_tools_error')}
            </p>
            <Button size="sm" variant="outline" onClick={() => void status.refetch()}>
              {localize('com_ui_retry')}
            </Button>
          </div>
        )}
        {status.isSuccess && shown.length === 0 && (
          <p className="text-text-secondary py-6 text-center text-sm">
            {localize('com_media_image_model_none')}
          </p>
        )}
        {shown.length > 0 && (
          <div
            role="listbox"
            aria-label={localize('com_media_image_model_title')}
            className="-mx-2 min-h-0 flex-1 overflow-y-auto"
          >
            {persian.length > 0 && (
              <section aria-labelledby="image-models-persian">
                <h3
                  id="image-models-persian"
                  className="text-text-secondary px-3 pt-1 pb-1 text-xs font-semibold"
                >
                  {localize('com_media_image_model_group_persian')}
                </h3>
                <ul>{persian.map(row)}</ul>
              </section>
            )}
            {others.length > 0 && (
              <section aria-labelledby="image-models-all">
                <h3
                  id="image-models-all"
                  className="text-text-secondary px-3 pt-3 pb-1 text-xs font-semibold"
                >
                  {localize('com_media_image_model_group_all')}
                </h3>
                <ul>{others.map(row)}</ul>
              </section>
            )}
          </div>
        )}
        <p className="text-text-tertiary text-xs">{localize('com_media_image_model_footer')}</p>
      </OGDialogContent>
    </OGDialog>
  );
}
