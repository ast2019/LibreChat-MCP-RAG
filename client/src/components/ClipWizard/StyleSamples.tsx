import { Spinner } from '@librechat/client';
import type { TClipWizardStyleSampleRequest } from 'librechat-data-provider';
import { useClipStyleSampleQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';

/**
 * One sample picture. A built-in style is rendered once on the server (no charge) and kept; an
 * AI image model shows its sample only when the server already has one, and this never asks it
 * to make one. While a picture is missing or failed, the label still shows.
 */
export function StyleSample({
  kind,
  id,
  label,
  selected,
  onSelect,
}: TClipWizardStyleSampleRequest & {
  label: string;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const localize = useLocalize();
  const { data, isLoading } = useClipStyleSampleQuery({ kind, id });
  const picture = data ? (
    <img
      src={`data:${data.mime};base64,${data.base64}`}
      alt={localize('com_clipwizard_style_sample_alt', { 0: label })}
      className="aspect-video w-full rounded-md object-cover"
      loading="lazy"
    />
  ) : (
    <div
      className="bg-surface-secondary text-text-secondary flex aspect-video w-full items-center justify-center rounded-md text-xs"
      data-testid={`clipwizard-style-empty-${id}`}
    >
      {isLoading ? <Spinner className="size-4" /> : localize('com_clipwizard_style_sample_none')}
    </div>
  );
  const caption = <span className="text-text-primary text-xs">{label}</span>;
  const frame = 'border-border-light flex flex-col gap-1 rounded-lg border p-1.5 text-start';
  return onSelect ? (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected === true}
        data-testid={`clipwizard-style-${id}`}
        className={`${frame} w-full ${selected ? 'border-text-primary' : ''}`}
      >
        {picture}
        {caption}
      </button>
    </li>
  ) : (
    <li data-testid={`clipwizard-style-${id}`} className={frame}>
      {picture}
      {caption}
    </li>
  );
}

/** The built-in styles, each with its sample; with `onSelect` a click picks the style. */
export default function StyleSamples({
  themes,
  selected,
  onSelect,
}: {
  themes: Array<{ id: string; label: string }>;
  selected?: string;
  onSelect?: (id: string) => void;
}) {
  const localize = useLocalize();
  return (
    <ul
      className="grid grid-cols-2 gap-2 sm:grid-cols-3"
      aria-label={localize('com_clipwizard_style_samples')}
      data-testid="clipwizard-style-samples"
    >
      {themes.map((theme) => (
        <StyleSample
          key={theme.id}
          kind="theme"
          id={theme.id}
          label={theme.label}
          selected={selected === theme.id}
          onSelect={onSelect ? () => onSelect(theme.id) : undefined}
        />
      ))}
    </ul>
  );
}
