import { useMemo, useCallback, useSyncExternalStore } from 'react';
import { useRecoilValue } from 'recoil';
import type { VoiceOption } from '~/common';
import {
  speechLanguageMatches,
  useEffectiveLanguageTTS,
} from '~/components/Nav/SettingsTabs/Speech/speechLanguage';
import { subscribeSpeechVoices, getSpeechVoicesSnapshot } from '~/utils';
import store from '~/store';

function useTextToSpeechBrowser({
  setIsSpeaking,
}: {
  setIsSpeaking: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const voiceName = useRecoilValue(store.voice);
  const cloudBrowserVoices = useRecoilValue(store.cloudBrowserVoices);
  const languageTTS = useEffectiveLanguageTTS();
  const { voices: availableVoices, supported: isSpeechSynthesisSupported } = useSyncExternalStore(
    subscribeSpeechVoices,
    getSpeechVoicesSnapshot,
    getSpeechVoicesSnapshot,
  );

  const voices = useMemo(() => {
    const filteredVoices = availableVoices.filter(
      (v) => cloudBrowserVoices || v.localService === true,
    );
    /* Voices speaking the effective TTS language (the UI language by default) first, so
       the picker leads with them and an unset voice defaults to one (`useTTSBrowser`
       picks the first). A stable partition: the browser's own order is kept otherwise. */
    const matching = filteredVoices.filter((v) => speechLanguageMatches(v.lang, languageTTS));
    const ordered =
      matching.length === 0
        ? filteredVoices
        : [...matching, ...filteredVoices.filter((v) => !matching.includes(v))];
    return ordered.map((v): VoiceOption => ({ value: v.name, label: v.name }));
  }, [availableVoices, cloudBrowserVoices, languageTTS]);

  /** Reports whether an utterance was actually queued: autoplay must not mark a run as
   *  played when the voice list has not loaded yet, or the message is never spoken. */
  const generateSpeechLocal = useCallback(
    (text: string): boolean => {
      if (!isSpeechSynthesisSupported) {
        console.warn('Speech synthesis is not supported');
        return false;
      }

      const synth = window.speechSynthesis;
      const voice = voices.find((v) => v.value === voiceName);

      if (!voice) {
        console.warn('Selected voice not found');
        return false;
      }

      try {
        synth.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.voice = synth.getVoices().find((v) => v.name === voice.value) || null;
        utterance.onend = () => {
          setIsSpeaking(false);
        };
        utterance.onerror = (event) => {
          if (event.error === 'interrupted' || event.error === 'canceled') {
            setIsSpeaking(false);
            return;
          }

          console.error('Speech synthesis error:', event);
          setIsSpeaking(false);
        };
        setIsSpeaking(true);
        synth.speak(utterance);
        return true;
      } catch (error) {
        console.error('Error generating speech:', error);
        setIsSpeaking(false);
        return false;
      }
    },
    [isSpeechSynthesisSupported, voices, voiceName, setIsSpeaking],
  );

  const cancelSpeechLocal = useCallback(() => {
    if (!isSpeechSynthesisSupported) {
      return;
    }

    try {
      window.speechSynthesis.cancel();
    } catch (error) {
      console.error('Error cancelling speech:', error);
    } finally {
      setIsSpeaking(false);
    }
  }, [isSpeechSynthesisSupported, setIsSpeaking]);

  return { generateSpeechLocal, cancelSpeechLocal, voices, isSpeechSynthesisSupported };
}

export default useTextToSpeechBrowser;
