import { memo } from 'react';
import { useRecoilValue } from 'recoil';
import type { TMessageAudio } from '~/common';
import { BrowserTTS, ExternalTTS } from '~/components/Audio/TTS';
import useSpeechRoute from '~/hooks/Input/useSpeechRoute';
import { TTSEndpoints } from '~/common';
import store from '~/store';

function MessageAudio(props: TMessageAudio) {
  const engineTTS = useRecoilValue<string>(store.engineTTS);
  const speechSettingsInitialized = useRecoilValue(store.speechSettingsInitialized);
  /** A local conversation's text never leaves the device: browser speech only. */
  const { local } = useSpeechRoute(props.conversation);

  if (!speechSettingsInitialized) {
    return null;
  }

  const TTSComponents = {
    [TTSEndpoints.browser]: BrowserTTS,
    [TTSEndpoints.external]: ExternalTTS,
  };

  const SelectedTTS = local ? BrowserTTS : TTSComponents[engineTTS];
  if (!SelectedTTS) {
    return null;
  }
  return <SelectedTTS {...props} />;
}

export default memo(MessageAudio);
