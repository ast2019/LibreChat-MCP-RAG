import { useId } from 'react';
import { useAtom } from 'jotai';
import { Dropdown } from '@librechat/client';
import type { TClipWizardConfigResponse } from 'librechat-data-provider';
import { clipWizardModelIdAtom } from '~/store/clipWizard';
import { useLocalize } from '~/hooks';

/** The model in use: the user's pick when the server still lists it, else the server's default. */
export function useClipWizardModel(
  config: Pick<TClipWizardConfigResponse, 'models' | 'defaultModelId'>,
): [string, (id: string) => void] {
  const [picked, setPicked] = useAtom(clipWizardModelIdAtom);
  const listed = config.models.some((model) => model.id === picked);
  return [listed ? picked : (config.defaultModelId ?? config.models[0]?.id ?? ''), setPicked];
}

/** Picks the model that writes and edits the storyboard; only its label is shown. */
export default function Model({ config }: { config: TClipWizardConfigResponse }) {
  const localize = useLocalize();
  const [modelId, setModelId] = useClipWizardModel(config);
  const labelId = `${useId()}-model`;
  if (config.models.length === 0) {
    return (
      <p className="text-text-secondary text-sm" data-testid="clipwizard-model-empty">
        {localize('com_clipwizard_model_empty')}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span id={labelId} className="font-medium">
        {localize('com_clipwizard_model_label')}
      </span>
      <Dropdown
        value={modelId}
        onChange={setModelId}
        options={config.models.map((model) => ({ value: model.id, label: model.label }))}
        aria-labelledby={labelId}
        testId="clipwizard-model"
        variant="field"
      />
    </div>
  );
}
