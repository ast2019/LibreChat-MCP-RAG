import React, { useMemo } from 'react';
import { Lock } from 'lucide-react';
import { TooltipAnchor } from '@librechat/client';
import { getConfigDefaults } from 'librechat-data-provider';
import type { TModelSpec } from 'librechat-data-provider';
import type { ModelSelectorProps } from '~/common';
import {
  renderModelSpecs,
  renderEndpoints,
  renderSearchResults,
  renderCustomGroups,
} from './components';
import { ModelSelectorProvider, useModelSelectorContext } from './ModelSelectorContext';
import { useShortcutAriaKey, useShortcutHint } from '~/hooks/useKeyboardShortcuts';
import { ModelSelectorChatProvider } from './ModelSelectorChatContext';
import { getSelectedIcon, getDisplayValue } from './utils';
import { CustomMenu as Menu } from './CustomMenu';
import DialogManager from './DialogManager';
import useSpecPricing from '~/components/Pricing/useSpecPricing';
import { formatModelName } from '~/components/Pricing/name';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const defaultInterface = getConfigDefaults().interface;
/** Stable stand-in while no spec is chosen, so the pricing memo does not rerun every render. */
const noSpec = {} as Pick<TModelSpec, 'preset'>;

function ModelSelectorContent() {
  const localize = useLocalize();
  const modelSelectorHint = useShortcutHint('openModelSelector', localize('com_ui_select_model'));
  const modelSelectorAriaKey = useShortcutAriaKey('openModelSelector');

  const {
    // LibreChat
    agentsMap,
    modelSpecs,
    mappedEndpoints,
    endpointsConfig,
    modelSelectionMissing,
    specLocked,
    // State
    searchValue,
    searchResults,
    selectedValues,
    // Functions
    setSearchValue,
    setSelectedValues,
    // Dialog
    keyDialogOpen,
    onOpenChange,
    keyDialogEndpoint,
  } = useModelSelectorContext();

  const selectedIcon = useMemo(
    () =>
      getSelectedIcon({
        mappedEndpoints: mappedEndpoints ?? [],
        selectedValues,
        modelSpecs,
        endpointsConfig,
        agentsMap,
      }),
    [mappedEndpoints, selectedValues, modelSpecs, endpointsConfig, agentsMap],
  );
  const selectedDisplayValue = useMemo(
    () =>
      getDisplayValue({
        localize,
        agentsMap,
        modelSpecs,
        selectedValues,
        mappedEndpoints,
      }),
    [localize, agentsMap, modelSpecs, selectedValues, mappedEndpoints],
  );

  /** The exact model version the chosen spec runs, beside its label, so a `…-latest` spec
   *  says which model it is today. */
  const selectedSpec = useMemo(
    () => modelSpecs?.find((spec) => spec.name === selectedValues.modelSpec) ?? noSpec,
    [modelSpecs, selectedValues.modelSpec],
  );
  const { resolved: selectedVersion } = useSpecPricing(selectedSpec);
  const selectedVersionName = selectedVersion != null ? formatModelName(selectedVersion) : null;

  /** Screen readers read the button's own label, so the lock is announced there too. */
  const triggerLabel = specLocked
    ? `${localize('com_ui_select_model')} (${localize('com_ui_private_chat_model_locked_label')})`
    : localize('com_ui_select_model');
  const trigger = (
    <TooltipAnchor
      aria-label={triggerLabel}
      description={
        specLocked ? localize('com_ui_private_chat_model_locked_label') : modelSelectorHint
      }
      render={
        <button
          data-testid="model-selector-button"
          data-model-missing={modelSelectionMissing ? 'true' : undefined}
          aria-keyshortcuts={modelSelectorAriaKey}
          className={cn(
            'border-border-chrome bg-presentation text-text-primary hover:bg-surface-active-alt rounded-theme-control relative my-1 flex h-9 max-w-full items-center gap-2 border px-3 py-2 text-sm',
            /* No model chosen yet: a highlighted, pulsing ring invites the pick. */
            modelSelectionMissing && 'ring-ring-primary font-medium ring-2',
          )}
          aria-label={triggerLabel}
        >
          {modelSelectionMissing && (
            <span
              aria-hidden="true"
              className="ring-ring-primary rounded-theme-control pointer-events-none absolute -inset-1 ring-2 motion-safe:animate-pulse"
            />
          )}
          {selectedIcon && React.isValidElement(selectedIcon) && (
            <div className="flex shrink-0 items-center justify-center overflow-hidden">
              {selectedIcon}
            </div>
          )}
          <span className="truncate text-start">{selectedDisplayValue}</span>
          {selectedVersionName != null && selectedVersionName !== selectedDisplayValue && (
            <span
              title={selectedVersion}
              data-testid="model-selector-version"
              className="text-text-secondary hidden max-w-32 shrink-0 truncate text-xs sm:inline"
            >
              {selectedVersionName}
            </span>
          )}
          {specLocked && (
            <Lock
              className="text-text-secondary size-3.5 shrink-0"
              aria-hidden="true"
              data-testid="model-selector-spec-lock"
            />
          )}
        </button>
      }
    />
  );

  return (
    <div className="relative flex max-w-[60vw] min-w-0 flex-col items-center gap-2 sm:max-w-xs">
      <Menu
        values={selectedValues}
        onValuesChange={(values: Record<string, any>) => {
          setSelectedValues({
            endpoint: values.endpoint || '',
            model: values.model || '',
            modelSpec: values.modelSpec || '',
          });
        }}
        onSearch={(value) => setSearchValue(value)}
        combobox={<input id="model-search" placeholder=" " />}
        comboboxLabel={localize('com_endpoint_search_models')}
        trigger={trigger}
      >
        {searchResults ? (
          renderSearchResults(searchResults, localize, searchValue)
        ) : (
          <>
            {/* Render ungrouped modelSpecs (no group field) */}
            {renderModelSpecs(
              modelSpecs?.filter((spec) => !spec.group) || [],
              selectedValues.modelSpec || '',
            )}
            {/* Render endpoints (will include grouped specs matching endpoint names) */}
            {renderEndpoints(mappedEndpoints ?? [])}
            {/* Render custom groups (specs with group field not matching any endpoint) */}
            {renderCustomGroups(modelSpecs || [], mappedEndpoints ?? [])}
          </>
        )}
      </Menu>
      <DialogManager
        keyDialogOpen={keyDialogOpen}
        onOpenChange={onOpenChange}
        endpointsConfig={endpointsConfig || {}}
        keyDialogEndpoint={keyDialogEndpoint || undefined}
      />
    </div>
  );
}

export default function ModelSelector({ startupConfig }: ModelSelectorProps) {
  const interfaceConfig = startupConfig?.interface ?? defaultInterface;
  const modelSpecs = startupConfig?.modelSpecs?.list ?? [];

  // Hide the selector when modelSelect is false and there are no model specs to show
  if (interfaceConfig.modelSelect === false && modelSpecs.length === 0) {
    return null;
  }

  return (
    <ModelSelectorChatProvider>
      <ModelSelectorProvider startupConfig={startupConfig}>
        <ModelSelectorContent />
      </ModelSelectorProvider>
    </ModelSelectorChatProvider>
  );
}
