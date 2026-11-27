import { createStore } from 'jotai';
import {
  clipWizardJobIdAtom,
  clipWizardModelIdsAtom,
  clipWizardSettingsAtom,
  clipWizardStepAtom,
  clipWizardStoryboardAtom,
  clipWizardTopicAtom,
  clipWizardVoiceIdAtom,
  DEFAULT_CLIP_WIZARD_SETTINGS,
  resetClipWizardAtom,
} from '../clipWizard';

describe('clip wizard store', () => {
  it('starts on the topic step with defaults', () => {
    const store = createStore();
    expect(store.get(clipWizardStepAtom)).toBe('topic');
    expect(store.get(clipWizardSettingsAtom)).toEqual(DEFAULT_CLIP_WIZARD_SETTINGS);
    expect(store.get(clipWizardStoryboardAtom)).toBeNull();
    expect(store.get(clipWizardJobIdAtom)).toBeNull();
  });

  it('reset clears every field', () => {
    const store = createStore();
    store.set(clipWizardStepAtom, 'render');
    store.set(clipWizardTopicAtom, 'solar');
    store.set(clipWizardSettingsAtom, { aspectRatio: '16:9', targetDurationSec: 60 });
    store.set(clipWizardStoryboardAtom, { title: 't', scenes: [{ type: 'hook' }] });
    store.set(clipWizardVoiceIdAtom, 'eleven-sarah');
    store.set(clipWizardModelIdsAtom, { storyboard: 'some/model' });
    store.set(clipWizardJobIdAtom, 'job-1');
    store.set(resetClipWizardAtom);
    expect(store.get(clipWizardStepAtom)).toBe('topic');
    expect(store.get(clipWizardTopicAtom)).toBe('');
    expect(store.get(clipWizardSettingsAtom)).toEqual(DEFAULT_CLIP_WIZARD_SETTINGS);
    expect(store.get(clipWizardStoryboardAtom)).toBeNull();
    expect(store.get(clipWizardVoiceIdAtom)).toBe('');
    expect(store.get(clipWizardModelIdsAtom)).toEqual({});
    expect(store.get(clipWizardJobIdAtom)).toBeNull();
  });
});
