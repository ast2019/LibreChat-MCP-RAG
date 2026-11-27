import { useState } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { Button, Spinner, Textarea } from '@librechat/client';
import type { TClipWizardErrorCode, TClipWizardIssue } from 'librechat-data-provider';
import { clipWizardStepAtom, clipWizardStoryboardAtom } from '~/store/clipWizard';
import { useValidateClipStoryboardMutation } from '~/data-provider';
import { clipWizardErrorCode } from './errors';
import { useLocalize } from '~/hooks';
import Notice from './Notice';

const SCENE_FIELD = /^scenes\[(\d+)\]/;

/** The scene an issue belongs to, or -1 for an issue on the storyboard as a whole. */
const sceneOf = (issue: TClipWizardIssue): number => {
  const match = SCENE_FIELD.exec(issue.field);
  return match ? Number(match[1]) : -1;
};

/** The storyboard as a list of scenes; each scene's narration can be edited, then it is checked. */
export default function Storyboard() {
  const localize = useLocalize();
  const [storyboard, setStoryboard] = useAtom(clipWizardStoryboardAtom);
  const setStep = useSetAtom(clipWizardStepAtom);
  const validate = useValidateClipStoryboardMutation();
  const [issues, setIssues] = useState<TClipWizardIssue[]>([]);
  const [valid, setValid] = useState<{ scenes: number; durationSec: number } | null>(null);
  const [error, setError] = useState<TClipWizardErrorCode | null>(null);

  if (!storyboard) {
    return (
      <section className="flex flex-col gap-3" aria-labelledby="clipwizard-storyboard-title">
        <h2 id="clipwizard-storyboard-title" className="text-lg font-semibold">
          {localize('com_clipwizard_step_storyboard')}
        </h2>
        <p className="text-text-secondary text-sm" data-testid="clipwizard-storyboard-empty">
          {localize('com_clipwizard_storyboard_empty')}
        </p>
        <div>
          <Button variant="outline" onClick={() => setStep('topic')}>
            {localize('com_clipwizard_back')}
          </Button>
        </div>
      </section>
    );
  }

  const setNarration = (index: number, narration: string) => {
    setValid(null);
    setStoryboard({
      ...storyboard,
      scenes: storyboard.scenes.map((scene, i) => (i === index ? { ...scene, narration } : scene)),
    });
  };

  const check = () => {
    setError(null);
    validate.mutate(
      { storyboard },
      {
        onSuccess: (result) => {
          if (result.ok) {
            setIssues([]);
            setValid({ scenes: result.scenes, durationSec: result.durationSec });
          } else {
            setIssues(result.issues);
            setValid(null);
          }
        },
        onError: (err) => setError(clipWizardErrorCode(err)),
      },
    );
  };

  const general = issues.filter((issue) => sceneOf(issue) === -1);
  return (
    <section className="flex flex-col gap-4" aria-labelledby="clipwizard-storyboard-title">
      <h2 id="clipwizard-storyboard-title" className="text-lg font-semibold">
        {localize('com_clipwizard_step_storyboard')}
      </h2>
      {general.length > 0 ? (
        <ul role="alert" className="text-text-destructive text-sm">
          {general.map((issue) => (
            <li key={`${issue.field}:${issue.message}`}>
              {issue.field}: {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
      <ol className="flex flex-col gap-3">
        {storyboard.scenes.map((scene, index) => {
          const own = issues.filter((issue) => sceneOf(issue) === index);
          return (
            <li
              key={index}
              data-testid={`clipwizard-scene-${index}`}
              className="border-border-light flex flex-col gap-2 rounded-lg border px-3 py-3"
            >
              <span className="text-text-primary text-sm font-medium">
                {localize('com_clipwizard_scene_label', {
                  0: index + 1,
                  1: String(scene.type ?? ''),
                })}
              </span>
              <label className="flex flex-col gap-1 text-sm">
                {localize('com_clipwizard_scene_narration')}
                <Textarea
                  value={typeof scene.narration === 'string' ? scene.narration : ''}
                  onChange={(event) => setNarration(index, event.target.value)}
                  rows={2}
                />
              </label>
              {own.length > 0 ? (
                <ul role="alert" className="text-text-destructive text-xs">
                  {own.map((issue) => (
                    <li key={`${issue.field}:${issue.message}`}>
                      {issue.field}: {issue.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>
      {error ? <Notice code={error} /> : null}
      {valid ? (
        <p role="status" className="text-text-secondary text-sm" data-testid="clipwizard-valid">
          {localize('com_clipwizard_valid', { 0: valid.scenes, 1: valid.durationSec })}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setStep('settings')}>
          {localize('com_clipwizard_back')}
        </Button>
        <Button variant="outline" onClick={check} disabled={validate.isLoading}>
          {validate.isLoading ? <Spinner className="size-4" /> : null}
          {localize('com_clipwizard_validate')}
        </Button>
        <Button onClick={() => setStep('preview')} disabled={valid == null}>
          {localize('com_clipwizard_next')}
        </Button>
      </div>
    </section>
  );
}
