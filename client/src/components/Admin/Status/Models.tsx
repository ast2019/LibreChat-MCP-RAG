import type { TLocalModel } from 'librechat-data-provider';
import { formatBytes, formatNumber, formatRelative, formatDateTime } from './format';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/** Past this, Ollama keeps the model loaded indefinitely (`keep_alive: -1`). */
const KEPT_LOADED_MS = 30 * 86_400_000;

function ModelRow({ model, locale, now }: { model: TLocalModel; locale: string; now: number }) {
  const localize = useLocalize();
  const meta = [
    model.parameterSize,
    model.quantization,
    model.sizeBytes != null ? formatBytes(model.sizeBytes, locale) : null,
  ].filter((part): part is string => part != null);

  const expires = model.expiresAt != null ? new Date(model.expiresAt).getTime() : NaN;
  let unloads: string | null = null;
  if (model.loaded && Number.isFinite(expires) && expires > now) {
    unloads =
      expires - now > KEPT_LOADED_MS
        ? localize('com_admin_status_models_kept_loaded')
        : localize('com_admin_status_models_unloads', {
            0: formatRelative(model.expiresAt as string, now, locale),
          });
  }

  return (
    <li
      data-testid={`ollama-model-${model.name}`}
      className={cn(
        'rounded-lg border px-3 py-2',
        model.loaded
          ? 'border-status-success-border bg-status-success-subtle'
          : 'border-border-light',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <bdi dir="ltr" className="text-text-primary min-w-0 truncate font-mono text-xs font-medium">
          {model.name}
        </bdi>
        {model.loaded && (
          <span className="border-status-success-border bg-surface-primary text-text-primary inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-xs">
            <span className="bg-status-success-strong size-1.5 rounded-full" aria-hidden="true" />
            {localize('com_admin_status_models_active')}
          </span>
        )}
      </div>
      {meta.length > 0 && (
        <p dir="ltr" className="text-text-secondary mt-0.5 text-start text-xs">
          <bdi>{meta.join(' · ')}</bdi>
        </p>
      )}
      {model.loaded && (
        <p className="text-text-secondary mt-0.5 text-xs">
          {localize('com_admin_status_models_running')}
          {model.vramBytes != null && (
            <>
              {' · '}
              {localize('com_admin_status_models_vram', {
                0: formatBytes(model.vramBytes, locale),
              })}
            </>
          )}
          {unloads != null && (
            <>
              {' · '}
              <time
                dateTime={model.expiresAt as string}
                title={formatDateTime(model.expiresAt as string, locale)}
              >
                {unloads}
              </time>
            </>
          )}
        </p>
      )}
    </li>
  );
}

/** The local Ollama models: every installed one, with the loaded (active) ones marked. */
export default function Models({
  models,
  loadedKnown,
  locale,
  now,
  titleId,
}: {
  models: TLocalModel[];
  loadedKnown: boolean;
  locale: string;
  now: number;
  titleId: string;
}) {
  const localize = useLocalize();
  const loaded = models.filter((model) => model.loaded).length;
  const installed = models.length;

  let note: string | null = null;
  if (installed === 0) {
    note = localize('com_admin_status_models_empty');
  } else if (!loadedKnown) {
    note = localize('com_admin_status_models_loaded_unknown');
  } else if (loaded === 0) {
    note = localize('com_admin_status_models_none_loaded');
  }

  return (
    <section aria-labelledby={titleId} className="space-y-2" data-testid="ollama-models">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <h4 id={titleId} className="text-text-primary text-xs font-semibold">
          {localize('com_admin_status_models_title')}
        </h4>
        {installed > 0 && (
          <p className="text-text-secondary text-xs">
            {loadedKnown
              ? localize('com_admin_status_models_summary', {
                  0: formatNumber(installed, locale),
                  1: formatNumber(loaded, locale),
                })
              : localize('com_admin_status_models_summary_installed', {
                  0: formatNumber(installed, locale),
                })}
          </p>
        )}
      </div>
      {note != null && <p className="text-text-secondary text-xs">{note}</p>}
      {installed > 0 && (
        <ul className="space-y-1.5">
          {models.map((model) => (
            <ModelRow key={model.name} model={model} locale={locale} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}
