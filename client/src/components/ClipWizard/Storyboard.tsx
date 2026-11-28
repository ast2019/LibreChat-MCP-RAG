import { useState } from 'react';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { Button, Dropdown, Spinner, Textarea } from '@librechat/client';
import type {
  TClipWizardConfigResponse,
  TClipWizardErrorCode,
  TClipWizardIssue,
} from 'librechat-data-provider';
import type { ClipWizardStoryboardState } from '~/store/clipWizard';
import {
  clipWizardCheckedAtom,
  clipWizardEstimateAtom,
  clipWizardImagesAtom,
  clipWizardStepAtom,
  clipWizardStoryboardAtom,
  clipWizardVoiceIdAtom,
} from '~/store/clipWizard';
import { useEstimateClipWizardMutation, useValidateClipStoryboardMutation } from '~/data-provider';
import { clipWizardErrorCode } from './errors';
import StyleSamples from './StyleSamples';
import { useLocalize } from '~/hooks';
import Notice from './Notice';
import Model from './Model';

const SCENE_FIELD = /^scenes\[(\d+)\]/;

/** The scene an issue belongs to, or -1 for an issue on the storyboard as a whole. */
const sceneOf = (issue: TClipWizardIssue): number => {
  const match = SCENE_FIELD.exec(issue.field);
  return match ? Number(match[1]) : -1;
};

const NO_VOICE = '__none__';
const NO_THEME = '__default__';

/**
 * The storyboard as a list of scenes. Every edit here (text, order, delete, voice, theme) is saved
 * on this device only and never calls the model; it makes the storyboard unchecked until the
 * user checks it again.
 */
export default function Storyboard({ config }: { config: TClipWizardConfigResponse }) {
  const localize = useLocalize();
  const [storyboard, setStoryboard] = useAtom(clipWizardStoryboardAtom);
  const setStep = useSetAtom(clipWizardStepAtom);
  const validate = useValidateClipStoryboardMutation();
  const estimate = useEstimateClipWizardMutation();
  const [voiceId, setVoiceId] = useAtom(clipWizardVoiceIdAtom);
  const images = useAtomValue(clipWizardImagesAtom);
  const [checked, setChecked] = useAtom(clipWizardCheckedAtom);
  const [estimated, setEstimated] = useAtom(clipWizardEstimateAtom);
  const [issues, setIssues] = useState<TClipWizardIssue[]>([]);
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

  /** Checked only while this is still the object the server approved: any edit makes a new one. */
  const valid = checked?.storyboard === storyboard ? checked : null;
  const estimateKey = `${voiceId}|${JSON.stringify(images)}`;
  const shownEstimate =
    estimated?.storyboard === storyboard && estimated.key === estimateKey ? estimated.result : null;

  const edit = (next: ClipWizardStoryboardState) => {
    setChecked(null);
    setStoryboard(next);
  };
  const setNarration = (index: number, narration: string) =>
    edit({
      ...storyboard,
      scenes: storyboard.scenes.map((scene, i) => (i === index ? { ...scene, narration } : scene)),
    });
  const move = (index: number, by: -1 | 1) => {
    const scenes = [...storyboard.scenes];
    [scenes[index], scenes[index + by]] = [scenes[index + by], scenes[index]];
    setIssues([]);
    edit({ ...storyboard, scenes });
  };
  const remove = (index: number) => {
    setIssues([]);
    edit({ ...storyboard, scenes: storyboard.scenes.filter((_, i) => i !== index) });
  };
  const setTheme = (theme: string) => {
    const { theme: _old, ...rest } = storyboard;
    edit(theme === NO_THEME ? (rest as ClipWizardStoryboardState) : { ...storyboard, theme });
  };

  const estimateCost = (target: ClipWizardStoryboardState) => {
    estimate.mutate(
      {
        storyboard: target,
        settings: { ...(voiceId ? { voiceId } : {}), images },
      },
      {
        onSuccess: (result) => {
          if (result.ok) {
            setEstimated({ storyboard: target, key: estimateKey, result });
          } else {
            setError('invalid_storyboard');
          }
        },
        onError: (err) => setError(clipWizardErrorCode(err)),
      },
    );
  };

  const check = () => {
    setError(null);
    validate.mutate(
      { storyboard },
      {
        onSuccess: (result) => {
          if (result.ok) {
            setIssues([]);
            setChecked({ storyboard, scenes: result.scenes, durationSec: result.durationSec });
            estimateCost(storyboard);
          } else {
            setIssues(result.issues);
            setChecked(null);
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
      <p className="text-text-secondary text-xs">{localize('com_clipwizard_edit_hint')}</p>
      <Model config={config} />
      <div className="flex flex-wrap gap-4">
        <div className="flex min-w-48 flex-col gap-1 text-sm">
          <span id="clipwizard-sb-voice">{localize('com_clipwizard_settings_voice')}</span>
          <Dropdown
            value={voiceId || NO_VOICE}
            onChange={(value) => {
              setChecked(null);
              setVoiceId(value === NO_VOICE ? '' : value);
            }}
            options={[
              { value: NO_VOICE, label: localize('com_clipwizard_voice_none') },
              ...config.voices.map((voice) => ({ value: voice.id, label: voice.label })),
            ]}
            aria-labelledby="clipwizard-sb-voice"
            testId="clipwizard-voice-select"
            variant="field"
          />
        </div>
        {config.themes.length > 0 ? (
          <div className="flex min-w-48 flex-col gap-1 text-sm">
            <span id="clipwizard-sb-theme">{localize('com_clipwizard_theme')}</span>
            <Dropdown
              value={typeof storyboard.theme === 'string' ? storyboard.theme : NO_THEME}
              onChange={setTheme}
              options={[
                { value: NO_THEME, label: localize('com_clipwizard_theme_default') },
                ...config.themes.map((theme) => ({ value: theme.id, label: theme.label })),
              ]}
              aria-labelledby="clipwizard-sb-theme"
              testId="clipwizard-theme-select"
              variant="field"
            />
          </div>
        ) : null}
      </div>
      {config.themes.length > 0 ? (
        <StyleSamples
          themes={config.themes}
          selected={typeof storyboard.theme === 'string' ? storyboard.theme : undefined}
          onSelect={setTheme}
        />
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
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  aria-label={localize('com_clipwizard_scene_up', { 0: index + 1 })}
                >
                  <ArrowUp className="size-4" aria-hidden="true" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={index === storyboard.scenes.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label={localize('com_clipwizard_scene_down', { 0: index + 1 })}
                >
                  <ArrowDown className="size-4" aria-hidden="true" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={storyboard.scenes.length <= 1}
                  onClick={() => remove(index)}
                  aria-label={localize('com_clipwizard_scene_delete', { 0: index + 1 })}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>
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
      {estimate.isLoading ? (
        <p role="status" className="text-text-secondary text-sm">
          {localize('com_clipwizard_estimate_working')}
        </p>
      ) : null}
      {shownEstimate ? (
        <dl
          className="border-border-light flex flex-col gap-1 rounded-lg border px-3 py-2 text-sm"
          data-testid="clipwizard-estimate"
        >
          <dt className="font-medium">{localize('com_clipwizard_estimate_title')}</dt>
          <dd>
            {localize('com_clipwizard_estimate_narration', {
              0: shownEstimate.items.narrationCredits,
            })}
          </dd>
          <dd>
            {localize('com_clipwizard_estimate_images', {
              0: shownEstimate.items.imageCredits,
              1: shownEstimate.imageCount,
            })}
          </dd>
          <dd className="font-medium">
            {localize('com_clipwizard_estimate_total', { 0: shownEstimate.totalCredits })}
          </dd>
          {shownEstimate.capCredits ? (
            <dd className="text-text-secondary text-xs">
              {localize('com_clipwizard_estimate_cap', { 0: shownEstimate.capCredits })}
            </dd>
          ) : null}
        </dl>
      ) : null}
      {valid && !shownEstimate && !estimate.isLoading ? (
        <div>
          <Button variant="outline" size="sm" onClick={() => estimateCost(storyboard)}>
            {localize('com_clipwizard_estimate_update')}
          </Button>
        </div>
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
