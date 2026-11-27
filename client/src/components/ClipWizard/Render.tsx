import { useState } from 'react';
import { Button, Spinner } from '@librechat/client';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import type { TClipWizardErrorCode, TClipWizardIssue } from 'librechat-data-provider';
import {
  clipWizardImagesAtom,
  clipWizardJobIdAtom,
  clipWizardSettingsAtom,
  clipWizardStepAtom,
  clipWizardStoryboardAtom,
  clipWizardVoiceIdAtom,
  resetClipWizardAtom,
} from '~/store/clipWizard';
import { clipWizardErrorCode, clipWizardErrorIssues } from './errors';
import MediaJob from '~/components/Chat/Messages/Content/MediaJob';
import { useStartClipRenderMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';
import Notice from './Notice';

/** Starts the render (credit is held first on the server) and then follows the job's card. */
export default function Render() {
  const localize = useLocalize();
  const storyboard = useAtomValue(clipWizardStoryboardAtom);
  const settings = useAtomValue(clipWizardSettingsAtom);
  const voiceId = useAtomValue(clipWizardVoiceIdAtom);
  const images = useAtomValue(clipWizardImagesAtom);
  const [jobId, setJobId] = useAtom(clipWizardJobIdAtom);
  const setStep = useSetAtom(clipWizardStepAtom);
  const reset = useSetAtom(resetClipWizardAtom);
  const render = useStartClipRenderMutation();
  const [error, setError] = useState<TClipWizardErrorCode | null>(null);
  const [issues, setIssues] = useState<TClipWizardIssue[]>([]);

  const start = () => {
    if (!storyboard) {
      return;
    }
    setError(null);
    setIssues([]);
    render.mutate(
      {
        storyboard,
        settings: {
          aspectRatio: settings.aspectRatio,
          ...(voiceId ? { voiceId } : {}),
          ...(images.source !== 'builtin' ? { images } : {}),
        },
      },
      {
        onSuccess: (result) => setJobId(result.jobId),
        onError: (err) => {
          setError(clipWizardErrorCode(err));
          setIssues(clipWizardErrorIssues(err));
        },
      },
    );
  };

  return (
    <section className="flex flex-col gap-4" aria-labelledby="clipwizard-render-title">
      <h2 id="clipwizard-render-title" className="text-lg font-semibold">
        {localize('com_clipwizard_step_render')}
      </h2>
      {jobId ? (
        <>
          <MediaJob jobId={jobId} />
          <div>
            <Button variant="outline" onClick={() => reset()}>
              {localize('com_clipwizard_new')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-text-secondary text-sm">{localize('com_clipwizard_render_hint')}</p>
          {error ? <Notice code={error} /> : null}
          {issues.length > 0 ? (
            <ul className="text-text-destructive text-xs">
              {issues.map((issue) => (
                <li key={`${issue.field}:${issue.message}`}>
                  {issue.field}: {issue.message}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep('preview')}>
              {localize('com_clipwizard_back')}
            </Button>
            <Button onClick={start} disabled={render.isLoading || !storyboard}>
              {render.isLoading ? <Spinner className="size-4" /> : null}
              {localize(error ? 'com_clipwizard_retry' : 'com_clipwizard_render_start')}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
