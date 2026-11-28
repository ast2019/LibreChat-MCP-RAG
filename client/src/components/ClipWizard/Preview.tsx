import { useState } from 'react';
import { Button, Spinner } from '@librechat/client';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import type { TClipWizardConfigResponse, TClipWizardErrorCode } from 'librechat-data-provider';
import {
  clipWizardImagesAtom,
  clipWizardPreviewAtom,
  clipWizardSettingsAtom,
  clipWizardStepAtom,
  clipWizardStoryboardAtom,
} from '~/store/clipWizard';
import { usePreviewClipWizardMutation } from '~/data-provider';
import { clipWizardErrorCode } from './errors';
import { useLocalize } from '~/hooks';
import Notice from './Notice';

/**
 * Key frames of the storyboard, one per scene, before the full render. Free: AI and stock images
 * show as grey placeholders and nothing is narrated. Skipping it is always possible.
 */
export default function Preview({ config }: { config: TClipWizardConfigResponse }) {
  const localize = useLocalize();
  const setStep = useSetAtom(clipWizardStepAtom);
  const storyboard = useAtomValue(clipWizardStoryboardAtom);
  const settings = useAtomValue(clipWizardSettingsAtom);
  const images = useAtomValue(clipWizardImagesAtom);
  const [stored, setStored] = useAtom(clipWizardPreviewAtom);
  const preview = usePreviewClipWizardMutation();
  const [error, setError] = useState<TClipWizardErrorCode | null>(null);

  const key = `${settings.aspectRatio}|${JSON.stringify(images)}`;
  const shown = stored?.storyboard === storyboard && stored.key === key ? stored.result : null;

  const make = () => {
    if (!storyboard) {
      return;
    }
    setError(null);
    preview.mutate(
      {
        storyboard,
        settings: {
          aspectRatio: settings.aspectRatio,
          ...(images.source !== 'builtin' ? { images } : {}),
        },
      },
      {
        onSuccess: (result) => setStored({ storyboard, key, result }),
        onError: (err) => setError(clipWizardErrorCode(err)),
      },
    );
  };

  return (
    <section className="flex flex-col gap-4" aria-labelledby="clipwizard-preview-title">
      <h2 id="clipwizard-preview-title" className="text-lg font-semibold">
        {localize('com_clipwizard_step_preview')}
      </h2>
      {!config.preview ? (
        <p className="text-text-secondary text-sm" data-testid="clipwizard-preview-off">
          {localize('com_clipwizard_preview_off')}
        </p>
      ) : (
        <>
          <p className="text-text-secondary text-sm">{localize('com_clipwizard_preview_hint')}</p>
          <div>
            <Button
              variant="outline"
              onClick={make}
              disabled={preview.isLoading || !storyboard}
              data-testid="clipwizard-preview-make"
            >
              {preview.isLoading ? <Spinner className="size-4" /> : null}
              {localize(shown ? 'com_clipwizard_preview_again' : 'com_clipwizard_preview_make')}
            </Button>
          </div>
          {preview.isLoading ? (
            <p role="status" className="text-text-secondary text-sm">
              {localize('com_clipwizard_preview_working')}
            </p>
          ) : null}
          {error ? <Notice code={error} /> : null}
          {shown ? (
            <>
              {shown.stills.length === 0 ? (
                <p className="text-text-secondary text-sm">
                  {localize('com_clipwizard_preview_empty')}
                </p>
              ) : (
                <ol className="grid grid-cols-2 gap-2" data-testid="clipwizard-preview-stills">
                  {shown.stills.map((still, index) => (
                    <li key={still.frame} className="border-border-light rounded-lg border p-1.5">
                      <img
                        src={`data:${still.mime};base64,${still.base64}`}
                        alt={localize('com_clipwizard_preview_frame', { 0: index + 1 })}
                        className="w-full rounded-md"
                      />
                      <span className="text-text-secondary text-xs">
                        {localize('com_clipwizard_preview_frame', { 0: index + 1 })}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              {shown.notes.length > 0 ? (
                <ul className="text-text-secondary text-xs">
                  {shown.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
        </>
      )}
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setStep('storyboard')}>
          {localize('com_clipwizard_back')}
        </Button>
        <Button onClick={() => setStep('render')}>{localize('com_clipwizard_next')}</Button>
      </div>
    </section>
  );
}
