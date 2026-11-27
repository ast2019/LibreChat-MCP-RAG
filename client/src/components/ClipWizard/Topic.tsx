import { useState } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { Button, Spinner, Textarea } from '@librechat/client';
import type { TClipWizardConfigResponse, TClipWizardErrorCode } from 'librechat-data-provider';
import type { ClipWizardStoryboardState } from '~/store/clipWizard';
import {
  clipWizardImagesAtom,
  clipWizardSettingsAtom,
  clipWizardStepAtom,
  clipWizardStoryboardAtom,
  clipWizardTopicAtom,
} from '~/store/clipWizard';
import { useDraftClipWizardMutation } from '~/data-provider';
import { clipWizardErrorCode } from './errors';
import { useClipWizardModel } from './Model';
import { useLocalize } from '~/hooks';
import Notice from './Notice';
import Model from './Model';

/** A storyboard object with a scenes list, or null when the text is not one. */
export function parseStoryboard(text: string): ClipWizardStoryboardState | null {
  try {
    const value: unknown = JSON.parse(text);
    if (
      value != null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Array.isArray((value as { scenes?: unknown }).scenes) &&
      (value as { scenes: unknown[] }).scenes.every(
        (scene) => scene != null && typeof scene === 'object' && !Array.isArray(scene),
      )
    ) {
      return value as ClipWizardStoryboardState;
    }
  } catch {
    // not JSON
  }
  return null;
}

export default function Topic({ config }: { config: TClipWizardConfigResponse }) {
  const localize = useLocalize();
  const [topic, setTopic] = useAtom(clipWizardTopicAtom);
  const [storyboard, setStoryboard] = useAtom(clipWizardStoryboardAtom);
  const setStep = useSetAtom(clipWizardStepAtom);
  const [text, setText] = useState(() => (storyboard ? JSON.stringify(storyboard, null, 2) : ''));
  const [invalid, setInvalid] = useState(false);
  const settings = useAtomValue(clipWizardSettingsAtom);
  const images = useAtomValue(clipWizardImagesAtom);
  const [modelId] = useClipWizardModel(config);
  const draft = useDraftClipWizardMutation();
  const [error, setError] = useState<TClipWizardErrorCode | null>(null);
  const tooShort = topic.trim().length < 3;

  const write = () => {
    if (tooShort || !modelId || draft.isLoading) {
      return;
    }
    setError(null);
    draft.mutate(
      {
        topic: topic.trim(),
        settings: {
          aspectRatio: settings.aspectRatio,
          targetDurationSec: settings.targetDurationSec,
        },
        modelId,
        images,
      },
      {
        onSuccess: (result) => {
          setStoryboard(result.storyboard as ClipWizardStoryboardState);
          setText(JSON.stringify(result.storyboard, null, 2));
          setStep('storyboard');
        },
        onError: (err) => setError(clipWizardErrorCode(err)),
      },
    );
  };

  const useText = () => {
    const parsed = parseStoryboard(text);
    setInvalid(parsed == null);
    if (parsed) {
      setStoryboard(parsed);
    }
  };

  return (
    <section className="flex flex-col gap-4" aria-labelledby="clipwizard-topic-title">
      <h2 id="clipwizard-topic-title" className="text-lg font-semibold">
        {localize('com_clipwizard_step_topic')}
      </h2>
      <label className="flex flex-col gap-1 text-sm">
        {localize('com_clipwizard_topic_label')}
        <Textarea
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          placeholder={localize('com_clipwizard_topic_placeholder')}
          rows={3}
        />
      </label>
      <Model config={config} />
      <div className="flex flex-col gap-2">
        <div>
          <Button onClick={write} disabled={tooShort || !modelId || draft.isLoading}>
            {draft.isLoading ? <Spinner className="size-4" /> : null}
            {localize('com_clipwizard_draft_write')}
          </Button>
        </div>
        {draft.isLoading ? (
          <p
            role="status"
            className="text-text-secondary text-sm"
            data-testid="clipwizard-draft-loading"
          >
            {localize('com_clipwizard_draft_working')}
          </p>
        ) : (
          <p className="text-text-secondary text-xs">{localize('com_clipwizard_draft_hint')}</p>
        )}
        {error ? <Notice code={error} /> : null}
      </div>
      <details className="flex flex-col gap-2 text-sm">
        <summary className="text-text-secondary cursor-pointer">
          {localize('com_clipwizard_advanced')}
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm">
            {localize('com_clipwizard_paste_label')}
            <Textarea
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setInvalid(false);
              }}
              rows={8}
              dir="ltr"
              spellCheck={false}
              aria-invalid={invalid}
            />
          </label>
          {invalid ? (
            <p role="alert" className="text-text-destructive text-sm">
              {localize('com_clipwizard_paste_invalid')}
            </p>
          ) : null}
          <div>
            <Button variant="outline" onClick={useText} disabled={!text.trim()}>
              {localize('com_clipwizard_paste_use')}
            </Button>
          </div>
        </div>
      </details>
      <div>
        <Button onClick={() => setStep('settings')}>{localize('com_clipwizard_next')}</Button>
      </div>
    </section>
  );
}
