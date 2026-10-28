import type { SpeechRoute } from './useSpeechRoute';
import useSpeechToTextExternal from './useSpeechToTextExternal';
import useSpeechToTextBrowser from './useSpeechToTextBrowser';
import useGetAudioSettings from './useGetAudioSettings';

const useSpeechToText = (
  setText: (text: string, takeId?: number) => void,
  onTranscriptionComplete: (text: string, takeId?: number) => void,
  onTranscriptionSettled: (takeId?: number) => void,
  /** Host-owned Auto Send Text preference. */
  autoSendText: number,
  /** The composer's conversation; a local one keeps audio on the device (browser engine). */
  route?: SpeechRoute,
): {
  isLoading?: boolean;
  isListening?: boolean;
  stopRecording: () => void | Promise<void>;
  startRecording: (takeId?: number) => void | Promise<void>;
  /** Ends capture without producing a transcript. */
  abortRecording: () => void;
} => {
  const { speechToTextEndpoint } = useGetAudioSettings();
  const externalSpeechToText = speechToTextEndpoint === 'external' && route?.local !== true;

  const {
    isListening: speechIsListeningBrowser,
    isLoading: speechIsLoadingBrowser,
    startRecording: startSpeechRecordingBrowser,
    stopRecording: stopSpeechRecordingBrowser,
    abortRecording: abortSpeechRecordingBrowser,
  } = useSpeechToTextBrowser(
    setText,
    onTranscriptionComplete,
    onTranscriptionSettled,
    autoSendText,
  );

  const {
    isListening: speechIsListeningExternal,
    isLoading: speechIsLoadingExternal,
    externalStartRecording: startSpeechRecordingExternal,
    externalStopRecording: stopSpeechRecordingExternal,
    externalAbortRecording: abortSpeechRecordingExternal,
  } = useSpeechToTextExternal(
    setText,
    onTranscriptionComplete,
    onTranscriptionSettled,
    autoSendText,
    route?.fields,
  );

  const isListening = externalSpeechToText ? speechIsListeningExternal : speechIsListeningBrowser;
  const isLoading = externalSpeechToText ? speechIsLoadingExternal : speechIsLoadingBrowser;

  const startRecording = externalSpeechToText
    ? startSpeechRecordingExternal
    : startSpeechRecordingBrowser;
  const stopRecording = externalSpeechToText
    ? stopSpeechRecordingExternal
    : stopSpeechRecordingBrowser;

  const abortRecording = externalSpeechToText
    ? abortSpeechRecordingExternal
    : abortSpeechRecordingBrowser;

  return {
    isLoading,
    isListening,
    stopRecording,
    startRecording,
    abortRecording,
  };
};

export default useSpeechToText;
