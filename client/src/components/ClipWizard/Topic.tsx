import { useState } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { Button, Textarea } from '@librechat/client';
import type { ClipWizardStoryboardState } from '~/store/clipWizard';
import { clipWizardStepAtom, clipWizardStoryboardAtom, clipWizardTopicAtom } from '~/store/clipWizard';
import { useLocalize } from '~/hooks';

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

export default function Topic() {
  const localize = useLocalize();
  const [topic, setTopic] = useAtom(clipWizardTopicAtom);
  const [storyboard, setStoryboard] = useAtom(clipWizardStoryboardAtom);
  const setStep = useSetAtom(clipWizardStepAtom);
  const [text, setText] = useState(() => (storyboard ? JSON.stringify(storyboard, null, 2) : ''));
  const [invalid, setInvalid] = useState(false);

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
      <div
        data-testid="clipwizard-draft-placeholder"
        className="border-border-light bg-surface-secondary flex flex-col gap-1 rounded-lg border px-3 py-3 text-sm"
      >
        <span className="text-text-primary font-medium">
          {localize('com_clipwizard_draft_placeholder_title')}
        </span>
        <span className="text-text-secondary">{localize('com_clipwizard_draft_placeholder_body')}</span>
      </div>
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
          className="font-mono text-xs"
        />
      </label>
      {invalid ? (
        <p role="alert" className="text-text-destructive text-sm">
          {localize('com_clipwizard_paste_invalid')}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={useText} disabled={!text.trim()}>
          {localize('com_clipwizard_paste_use')}
        </Button>
        <Button onClick={() => setStep('settings')}>{localize('com_clipwizard_next')}</Button>
      </div>
    </section>
  );
}
