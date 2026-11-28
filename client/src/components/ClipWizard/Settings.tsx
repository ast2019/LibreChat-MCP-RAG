import { useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { useAtom, useSetAtom } from 'jotai';
import { Button, Dropdown, Spinner } from '@librechat/client';
import type {
  TClipWizardConfigResponse,
  TClipWizardErrorCode,
  TClipWizardImages,
  TClipWizardVoice,
} from 'librechat-data-provider';
import {
  clipWizardImagesAtom,
  clipWizardSettingsAtom,
  clipWizardStepAtom,
  clipWizardVoiceIdAtom,
} from '~/store/clipWizard';
import { useClipVoiceSampleMutation } from '~/data-provider';
import StyleSamples, { StyleSample } from './StyleSamples';
import { clipWizardErrorCode } from './errors';
import { useLocalize } from '~/hooks';
import Notice from './Notice';
import Model from './Model';

type SampleState =
  | { voiceId: string; status: 'loading' }
  | { voiceId: string; status: 'error'; code: TClipWizardErrorCode };

function VoiceRow({
  voice,
  selected,
  onSelect,
  state,
  onPlay,
}: {
  voice: TClipWizardVoice;
  selected: boolean;
  onSelect: () => void;
  state?: SampleState;
  onPlay: () => void;
}) {
  const localize = useLocalize();
  const loading = state?.status === 'loading';
  return (
    <li className="flex flex-col gap-1">
      <div className="border-border-light flex items-center gap-3 rounded-lg border px-3 py-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
          <input type="radio" name="clipwizard-voice" checked={selected} onChange={onSelect} />
          <span className="text-text-primary truncate">{voice.label}</span>
          <span className="text-text-secondary text-xs">
            {localize(
              voice.priceHint === 'paid'
                ? 'com_clipwizard_voice_paid'
                : 'com_clipwizard_voice_free',
            )}
          </span>
        </label>
        {voice.hasSample ? (
          <Button
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={onPlay}
            aria-label={localize('com_clipwizard_voice_play', { 0: voice.label })}
          >
            {loading ? (
              <Spinner className="size-4" />
            ) : (
              <Play className="size-4" aria-hidden="true" />
            )}
          </Button>
        ) : null}
      </div>
      {state?.status === 'error' ? <Notice code={state.code} /> : null}
    </li>
  );
}

/** Where AI images come from: built-in styles, an image model, and a spending cap. */
function ImageSettings({ config }: { config: TClipWizardConfigResponse }) {
  const localize = useLocalize();
  const [images, setImages] = useAtom(clipWizardImagesAtom);
  const sources: Array<{ id: TClipWizardImages['source']; label: Parameters<typeof localize>[0] }> =
    [{ id: 'builtin', label: 'com_clipwizard_images_builtin' }];
  const modelsOf = (source: 'openrouter' | 'higgsfield') =>
    config.imageModels.filter((model) => model.source === source);
  if (config.imageSources.ai && modelsOf('openrouter').length > 0) {
    sources.push({ id: 'openrouter', label: 'com_clipwizard_images_ai' });
  }
  /** Higgsfield exists in the UI only while the server says it is connected */
  if (config.imageSources.higgsfield && modelsOf('higgsfield').length > 0) {
    sources.push({ id: 'higgsfield', label: 'com_clipwizard_images_higgsfield' });
  }
  const models = images.source === 'builtin' ? [] : modelsOf(images.source);
  const model = models.find((item) => item.id === images.modelId) ?? models[0];
  const cap = config.imageCapCredits;

  const choose = (source: TClipWizardImages['source']) => {
    if (source === 'builtin') {
      setImages({ source });
      return;
    }
    const first = modelsOf(source)[0];
    setImages({
      source,
      modelId: first?.id,
      ...(images.maxCredits != null ? { maxCredits: images.maxCredits } : {}),
    });
  };

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">
        {localize('com_clipwizard_images_title')}
      </legend>
      <div className="flex flex-wrap gap-2">
        {sources.map((source) => (
          <Button
            key={source.id}
            size="sm"
            variant={images.source === source.id ? 'default' : 'outline'}
            aria-pressed={images.source === source.id}
            onClick={() => choose(source.id)}
          >
            {localize(source.label)}
          </Button>
        ))}
      </div>
      {images.source === 'builtin' && config.themes.length > 0 ? (
        <StyleSamples themes={config.themes} />
      ) : null}
      {images.source !== 'builtin' && model ? (
        <>
          {model.hasSample ? (
            <ul className="w-48">
              <StyleSample kind="image" id={model.id} label={model.label} />
            </ul>
          ) : null}
          <span id="clipwizard-image-model-label" className="text-sm">
            {localize('com_clipwizard_images_model')}
          </span>
          <Dropdown
            value={model.id}
            onChange={(modelId) => setImages({ ...images, modelId })}
            options={models.map((item) => ({ value: item.id, label: item.label }))}
            aria-labelledby="clipwizard-image-model-label"
            testId="clipwizard-image-model"
            variant="field"
          />
          <p className="text-text-secondary text-xs" data-testid="clipwizard-image-credits">
            {localize('com_clipwizard_images_credits', { 0: model.credits })}
          </p>
          <label className="flex flex-col gap-1 text-sm">
            {cap > 0
              ? localize('com_clipwizard_images_cap_max', { 0: cap })
              : localize('com_clipwizard_images_cap')}
            <input
              type="number"
              min={0}
              max={cap > 0 ? cap : undefined}
              value={images.maxCredits ?? ''}
              onChange={(event) => {
                if (event.target.value === '') {
                  const { maxCredits: _drop, ...rest } = images;
                  setImages(rest);
                  return;
                }
                const value = Math.round(Number(event.target.value));
                if (Number.isFinite(value)) {
                  setImages({
                    ...images,
                    maxCredits: Math.min(cap > 0 ? cap : value, Math.max(0, value)),
                  });
                }
              }}
              className="border-border-light w-32 rounded-lg border bg-transparent px-2 py-1"
            />
          </label>
        </>
      ) : null}
    </fieldset>
  );
}

/** Aspect ratio, target length and the narration voice, with a sample to hear first. */
export default function Settings({ config }: { config: TClipWizardConfigResponse }) {
  const localize = useLocalize();
  const [settings, setSettings] = useAtom(clipWizardSettingsAtom);
  const [voiceId, setVoiceId] = useAtom(clipWizardVoiceIdAtom);
  const setStep = useSetAtom(clipWizardStepAtom);
  const sample = useClipVoiceSampleMutation();
  const [state, setState] = useState<SampleState | undefined>();
  /** Samples already fetched in this visit; replaying one asks the server for nothing. */
  const heard = useRef(new Map<string, string>());

  const play = (src: string) => {
    const audio = new Audio(src);
    void audio.play()?.catch(() => undefined);
  };

  const onPlay = (id: string) => {
    const known = heard.current.get(id);
    if (known) {
      play(known);
      return;
    }
    setState({ voiceId: id, status: 'loading' });
    sample.mutate(
      { voiceId: id },
      {
        onSuccess: (data) => {
          const src = `data:${data.mime};base64,${data.base64}`;
          heard.current.set(id, src);
          setState(undefined);
          play(src);
        },
        onError: (error) =>
          setState({ voiceId: id, status: 'error', code: clipWizardErrorCode(error) }),
      },
    );
  };

  return (
    <section className="flex flex-col gap-5" aria-labelledby="clipwizard-settings-title">
      <h2 id="clipwizard-settings-title" className="text-lg font-semibold">
        {localize('com_clipwizard_step_settings')}
      </h2>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">
          {localize('com_clipwizard_settings_aspect')}
        </legend>
        <div className="flex flex-wrap gap-2">
          {config.aspectRatios.map((ratio) => (
            <Button
              key={ratio}
              size="sm"
              variant={settings.aspectRatio === ratio ? 'default' : 'outline'}
              aria-pressed={settings.aspectRatio === ratio}
              onClick={() => setSettings({ ...settings, aspectRatio: ratio })}
            >
              {ratio}
            </Button>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1 text-sm">
        {localize('com_clipwizard_settings_duration', { 0: config.limits.maxDurationSec })}
        <input
          type="number"
          min={5}
          max={config.limits.maxDurationSec}
          value={settings.targetDurationSec}
          onChange={(event) => {
            const value = Math.round(Number(event.target.value));
            if (Number.isFinite(value)) {
              setSettings({
                ...settings,
                targetDurationSec: Math.min(config.limits.maxDurationSec, Math.max(5, value)),
              });
            }
          }}
          className="border-border-light w-28 rounded-lg border bg-transparent px-2 py-1"
        />
      </label>
      <Model config={config} />
      <ImageSettings config={config} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">
          {localize('com_clipwizard_settings_voice')}
        </legend>
        {config.voices.length === 0 ? (
          <p className="text-text-secondary text-sm">{localize('com_clipwizard_voice_empty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            <li className="border-border-light rounded-lg border px-3 py-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="clipwizard-voice"
                  checked={voiceId === ''}
                  onChange={() => setVoiceId('')}
                />
                {localize('com_clipwizard_voice_none')}
              </label>
            </li>
            {config.voices.map((voice) => (
              <VoiceRow
                key={voice.id}
                voice={voice}
                selected={voiceId === voice.id}
                onSelect={() => setVoiceId(voice.id)}
                state={state?.voiceId === voice.id ? state : undefined}
                onPlay={() => onPlay(voice.id)}
              />
            ))}
          </ul>
        )}
      </fieldset>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setStep('topic')}>
          {localize('com_clipwizard_back')}
        </Button>
        <Button onClick={() => setStep('storyboard')}>{localize('com_clipwizard_next')}</Button>
      </div>
    </section>
  );
}
