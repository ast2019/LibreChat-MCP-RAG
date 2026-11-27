import { atom } from 'jotai';
import type { TClipWizardEstimateResponse, TClipWizardImages } from 'librechat-data-provider';

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
/** The model the user picked to write and edit the storyboard; empty uses the server's default */
export const clipWizardModelIdAtom = atom('');

/** Where AI images come from, the image model and the user's own spending cap (credits) */
export const DEFAULT_CLIP_WIZARD_IMAGES: TClipWizardImages = { source: 'builtin' };
export const clipWizardImagesAtom = atom<TClipWizardImages>(DEFAULT_CLIP_WIZARD_IMAGES);

export interface ClipWizardChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  /** The reply carried a new storyboard, which replaced the one on screen */
  updated?: boolean;
}
/** The in-wizard chat with the model; it never touches the normal chat */
export const clipWizardChatAtom = atom<ClipWizardChatMessage[]>([]);

/**
 * The storyboard object the server last approved. A storyboard counts as checked only while it
 * is still this very object, so any edit (which makes a new object) needs a new check.
 */
export const clipWizardCheckedAtom = atom<{
  storyboard: ClipWizardStoryboardState;
  scenes: number;
  durationSec: number;
} | null>(null);

/** The last cost estimate with what it was made for, so a change of voice or images makes it stale */
export const clipWizardEstimateAtom = atom<{
  storyboard: ClipWizardStoryboardState;
  key: string;
  result: Extract<TClipWizardEstimateResponse, { ok: true }>;
} | null>(null);
export const clipWizardJobIdAtom = atom<string | null>(null);

/** Back to a blank wizard. */
export const resetClipWizardAtom = atom(null, (_get, set) => {
  set(clipWizardStepAtom, 'topic');
  set(clipWizardTopicAtom, '');
  set(clipWizardSettingsAtom, DEFAULT_CLIP_WIZARD_SETTINGS);
  set(clipWizardStoryboardAtom, null);
  set(clipWizardVoiceIdAtom, '');
  set(clipWizardModelIdAtom, '');
  set(clipWizardImagesAtom, DEFAULT_CLIP_WIZARD_IMAGES);
  set(clipWizardChatAtom, []);
  set(clipWizardCheckedAtom, null);
  set(clipWizardEstimateAtom, null);
  set(clipWizardJobIdAtom, null);
});
