import { useAtomValue } from 'jotai';
import type { ClipWizardStep } from '~/store/clipWizard';
import type { TranslationKeys } from '~/hooks';
import { CLIP_WIZARD_STEPS, clipWizardStepAtom } from '~/store/clipWizard';
import { useLocalize } from '~/hooks';

const LABELS: Record<ClipWizardStep, TranslationKeys> = {
  topic: 'com_clipwizard_step_topic',
  settings: 'com_clipwizard_step_settings',
  storyboard: 'com_clipwizard_step_storyboard',
  preview: 'com_clipwizard_step_preview',
  render: 'com_clipwizard_step_render',
};

function stepClassName(isCurrent: boolean, isDone: boolean): string {
  if (isCurrent) {
    return 'bg-surface-tertiary text-text-primary rounded-full px-3 py-1 font-medium';
  }
  return isDone ? 'text-text-primary px-3 py-1' : 'text-text-secondary px-3 py-1';
}

/** The step indicator: the current step is marked for screen readers too. */
export default function Steps() {
  const localize = useLocalize();
  const current = useAtomValue(clipWizardStepAtom);
  const at = CLIP_WIZARD_STEPS.indexOf(current);
  return (
    <ol
      aria-label={localize('com_clipwizard_steps_label')}
      className="flex flex-wrap gap-2 text-sm"
    >
      {CLIP_WIZARD_STEPS.map((step, index) => (
        <li
          key={step}
          aria-current={step === current ? 'step' : undefined}
          data-testid={`clipwizard-step-${step}`}
          className={stepClassName(step === current, index < at)}
        >
          {index + 1}. {localize(LABELS[step])}
        </li>
      ))}
    </ol>
  );
}
