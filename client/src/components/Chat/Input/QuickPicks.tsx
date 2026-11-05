import { useCallback, useMemo } from 'react';
import type { TModelSpec } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks/useLocalize';
import SpecIcon from '~/components/Chat/Menus/Endpoints/components/SpecIcon';
import { useGetEndpointsQuery, useGetStartupConfig } from '~/data-provider';
import { useGetConversation, useLocalize, useNewConvo } from '~/hooks';
import { useAssistantsMapContext, useChatContext } from '~/Providers';
import useSelectMention from '~/hooks/Input/useSelectMention';
import { resolveQuickPicks } from './quickPicks';
import { mainTextareaId } from '~/common';
import { cn } from '~/utils';

/** Known `modelSpecs.quickPicks[].id` values → English keys. Unknown ids show as-is. */
const GROUP_TITLE_KEYS: Record<string, TranslationKeys> = {
  strongest: 'com_ui_model_quick_strongest',
  daily: 'com_ui_model_quick_daily',
};

/**
 * Landing-only one-click model shortcuts above the composer. Configured under
 * `modelSpecs.quickPicks`; disappears once a conversation has messages.
 */
export default function QuickPicks() {
  const localize = useLocalize();
  const { conversation } = useChatContext();
  const getConversation = useGetConversation(0);
  const { newConversation } = useNewConvo();
  const assistantsMap = useAssistantsMapContext();
  const { data: endpointsConfig = {} } = useGetEndpointsQuery();
  const { data: startupConfig } = useGetStartupConfig();

  const modelSpecs = useMemo(
    () => startupConfig?.modelSpecs?.list ?? [],
    [startupConfig?.modelSpecs?.list],
  );

  const groups = useMemo(
    () => resolveQuickPicks(startupConfig?.modelSpecs?.quickPicks, modelSpecs),
    [startupConfig?.modelSpecs?.quickPicks, modelSpecs],
  );

  const { onSelectSpec } = useSelectMention({
    modelSpecs,
    assistantsMap,
    endpointsConfig,
    getConversation,
    newConversation,
    returnHandlers: true,
  });

  const selectedSpec = conversation?.spec ?? '';

  const handleSelect = useCallback(
    (spec: TModelSpec) => {
      if (onSelectSpec?.(spec) === false) {
        return;
      }
      /** After a pick, put the caret in the composer so the next key starts a message. */
      requestAnimationFrame(() => {
        document.getElementById(mainTextareaId)?.focus();
      });
    },
    [onSelectSpec],
  );

  if (groups.length === 0) {
    return null;
  }

  return (
    <div
      data-testid="model-quick-picks"
      className="mb-3 flex w-full flex-col items-stretch gap-2.5 px-4 sm:items-center"
      role="group"
      aria-label={localize('com_ui_model_quick_picks')}
    >
      {groups.map((group) => {
        const titleKey = GROUP_TITLE_KEYS[group.id];
        const label = titleKey != null ? localize(titleKey) : group.id;

        return (
          <div
            key={group.id}
            data-testid={`model-quick-pick-group-${group.id}`}
            className="flex flex-col items-stretch gap-1.5 sm:items-center"
          >
            <p className="text-text-secondary px-0.5 text-center text-xs font-medium tracking-wide">
              {label}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {group.specs.map((spec, index) => {
                const selected = selectedSpec === spec.name;
                return (
                  <button
                    key={spec.name}
                    type="button"
                    data-testid={`model-quick-pick-${spec.name}`}
                    aria-pressed={selected}
                    aria-label={
                      selected
                        ? localize('com_ui_model_selected', { 0: spec.label })
                        : spec.label
                    }
                    title={spec.description || spec.label}
                    onClick={() => handleSelect(spec)}
                    style={{
                      animationDelay: `${index * 60}ms`,
                      animationFillMode: 'backwards',
                    }}
                    className={cn(
                      'fade-in border-border-light bg-surface-secondary text-text-secondary hover:bg-surface-hover hover:text-text-primary focus-visible:ring-text-primary inline-flex max-w-full cursor-pointer items-center gap-2 rounded-2xl border px-3 py-2 text-sm transition-colors duration-200 focus-visible:ring-2 focus-visible:outline-hidden',
                      selected &&
                        'border-border-medium bg-surface-active-alt text-text-primary ring-ring-primary ring-1',
                    )}
                  >
                    <SpecIcon currentSpec={spec} endpointsConfig={endpointsConfig} />
                    <span className="truncate">{spec.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
