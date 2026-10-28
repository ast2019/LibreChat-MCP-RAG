import React from 'react';
import { Dropdown } from '@librechat/client';
import { useRecoilState, useRecoilValue } from 'recoil';
import { useLocalize } from '~/hooks';
import store from '~/store';

interface EngineTTSDropdownProps {
  external: boolean;
  /** The external engine is HiveGPT's billed server speech (Persian-capable). */
  server?: boolean;
}

const EngineTTSDropdown: React.FC<EngineTTSDropdownProps> = ({ external, server = false }) => {
  const localize = useLocalize();
  const [engineTTS, setEngineTTS] = useRecoilState<string>(store.engineTTS);
  const textToSpeech = useRecoilValue(store.textToSpeech);

  const endpointOptions = external
    ? [
        { value: 'browser', label: localize('com_nav_browser') },
        {
          value: 'external',
          label: localize(server ? 'com_nav_speech_engine_server' : 'com_nav_external'),
        },
      ]
    : [{ value: 'browser', label: localize('com_nav_browser') }];

  const handleSelect = (value: string) => {
    setEngineTTS(value);
  };

  const labelId = 'engine-tts-dropdown-label';
  const hintId = 'engine-tts-dropdown-hint';
  const showHint = server && engineTTS === 'external';

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 flex-col">
        <div id={labelId}>{localize('com_nav_engine')}</div>
        {showHint && (
          <p id={hintId} className="text-text-secondary text-xs">
            {localize('com_nav_speech_server_hint')}
          </p>
        )}
      </div>
      <Dropdown
        value={engineTTS}
        onChange={handleSelect}
        options={endpointOptions}
        sizeClasses="z-50 w-[min(11.25rem,90vw)]"
        testId="EngineTTSDropdown"
        className="z-50"
        aria-labelledby={labelId}
        aria-describedby={showHint ? hintId : undefined}
        disabled={!textToSpeech}
      />
    </div>
  );
};

export default EngineTTSDropdown;
