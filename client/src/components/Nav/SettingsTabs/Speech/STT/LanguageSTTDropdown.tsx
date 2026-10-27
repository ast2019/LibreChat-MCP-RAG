import { useMemo } from 'react';
import { Dropdown } from '@librechat/client';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import {
  SPEECH_LANGUAGES,
  localizedLanguageName,
  useEffectiveLanguageSTT,
} from '../speechLanguage';
import { useLocalize } from '~/hooks';
import store from '~/store';

export default function LanguageSTTDropdown() {
  const localize = useLocalize();
  const setLanguageSTT = useSetRecoilState<string>(store.languageSTT);
  /** Shows the language actually used, so a Persian UI with no saved choice reads Persian
   *  rather than an empty picker. */
  const languageSTT = useEffectiveLanguageSTT();
  const uiLanguage = useRecoilValue<string>(store.lang);
  const speechToText = useRecoilValue(store.speechToText);

  const languageOptions = useMemo(
    () =>
      SPEECH_LANGUAGES.map((option) => ({
        value: option.value,
        label: localizedLanguageName(option, uiLanguage),
      })),
    [uiLanguage],
  );

  const handleSelect = (value: string) => {
    setLanguageSTT(value);
  };

  const labelId = 'language-stt-dropdown-label';

  return (
    <div className="flex items-center justify-between">
      <div id={labelId}>{localize('com_nav_language')}</div>
      <Dropdown
        value={languageSTT}
        onChange={handleSelect}
        options={languageOptions}
        testId="LanguageSTTDropdown"
        sizeClasses="z-50"
        className="z-50"
        aria-labelledby={labelId}
        disabled={!speechToText}
      />
    </div>
  );
}
