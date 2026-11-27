import { atom } from 'jotai';

export const CLIP_WIZARD_STEPS = ['topic', 'settings', 'storyboard', 'preview', 'render'] as const;
export type ClipWizardStep = (typeof CLIP_WIZARD_STEPS)[number];

export type ClipWizardAspect = '9:16' | '4:5' | '1:1' | '16:9';

export interface ClipWizardSettingsState {
  aspectRatio: ClipWizardAspect;
  /** Target length the drafting step (phase 2b) aims for; the storyboard's scenes set the real one */
  targetDurationSec: number;
}

/** The storyboard as the clip tool takes it: a title, a theme and scenes with narration. */
export type ClipWizardStoryboardState = Record<string, unknown> & {
  scenes: Array<Record<string, unknown>>;
};

export const DEFAULT_CLIP_WIZARD_SETTINGS: ClipWizardSettingsState = {
  aspectRatio: '9:16',
  targetDurationSec: 30,
};

export const clipWizardStepAtom = atom<ClipWizardStep>('topic');
export const clipWizardTopicAtom = atom('');
export const clipWizardSettingsAtom = atom<ClipWizardSettingsState>(DEFAULT_CLIP_WIZARD_SETTINGS);
export const clipWizardStoryboardAtom = atom<ClipWizardStoryboardState | null>(null);
/** A catalogue voice id; empty renders without narration */
export const clipWizardVoiceIdAtom = atom('');
/** The model the user picked for each step that calls one (used from phase 2b) */
export const clipWizardModelIdsAtom = atom<Partial<Record<ClipWizardStep, string>>>({});
export const clipWizardJobIdAtom = atom<string | null>(null);

/** Back to a blank wizard. */
export const resetClipWizardAtom = atom(null, (_get, set) => {
  set(clipWizardStepAtom, 'topic');
  set(clipWizardTopicAtom, '');
  set(clipWizardSettingsAtom, DEFAULT_CLIP_WIZARD_SETTINGS);
  set(clipWizardStoryboardAtom, null);
  set(clipWizardVoiceIdAtom, '');
  set(clipWizardModelIdsAtom, {});
  set(clipWizardJobIdAtom, null);
});
