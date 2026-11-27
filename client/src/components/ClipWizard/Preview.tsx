import { useSetAtom } from 'jotai';
import { Button } from '@librechat/client';
import { clipWizardStepAtom } from '~/store/clipWizard';
import { useLocalize } from '~/hooks';

/** Placeholder: key-frame previews inside the wizard arrive with phase 2b. */
export default function Preview() {
  const localize = useLocalize();
  const setStep = useSetAtom(clipWizardStepAtom);
  return (
    <section className="flex flex-col gap-4" aria-labelledby="clipwizard-preview-title">
      <h2 id="clipwizard-preview-title" className="text-lg font-semibold">
        {localize('com_clipwizard_step_preview')}
      </h2>
      <div
        data-testid="clipwizard-preview-placeholder"
        className="border-border-light bg-surface-secondary flex flex-col gap-1 rounded-lg border px-3 py-3 text-sm"
      >
        <span className="text-text-primary font-medium">
          {localize('com_clipwizard_preview_placeholder_title')}
        </span>
        <span className="text-text-secondary">{localize('com_clipwizard_preview_placeholder_body')}</span>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setStep('storyboard')}>
          {localize('com_clipwizard_back')}
        </Button>
        <Button onClick={() => setStep('render')}>{localize('com_clipwizard_next')}</Button>
      </div>
    </section>
  );
}
