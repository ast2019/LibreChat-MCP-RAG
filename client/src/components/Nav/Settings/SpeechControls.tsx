import { useGetCustomConfigSpeechQuery } from 'librechat-data-provider/react-query';
import { EngineSTTDropdown } from '../SettingsTabs/Speech/STT';
import { EngineTTSDropdown } from '../SettingsTabs/Speech/TTS';

export function EngineSTTSetting() {
  const { data } = useGetCustomConfigSpeechQuery();
  return (
    <EngineSTTDropdown
      external={Boolean(data?.sttExternal)}
      server={data?.serverSpeech?.stt != null}
    />
  );
}

export function EngineTTSSetting() {
  const { data } = useGetCustomConfigSpeechQuery();
  return (
    <EngineTTSDropdown
      external={Boolean(data?.ttsExternal)}
      server={data?.serverSpeech?.tts != null}
    />
  );
}
