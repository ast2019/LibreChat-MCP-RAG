import { useMemo } from 'react';
import { useRecoilValue } from 'recoil';
import store from '~/store';

/**
 * Speech recognition languages offered under Settings → Speech. `label` is the English
 * name, used only when the runtime cannot name the language itself; the UI shows the
 * name `Intl.DisplayNames` gives in the current UI language. `displayTag` overrides the
 * tag asked of `Intl` where `value` is not one it names well (`sr-SP` carries a retired
 * region), and `null` keeps the English label (Pig Latin is not a real language tag).
 */
export interface SpeechLanguageOption {
  value: string;
  label: string;
  displayTag?: string | null;
}

/** Persian first: HiveGPT is a Persian product, so it should not hide mid-list. */
export const SPEECH_LANGUAGES: SpeechLanguageOption[] = [
  { value: 'fa-IR', label: 'Persian (Iran)' },
  { value: 'af', label: 'Afrikaans' },
  { value: 'eu', label: 'Basque' },
  { value: 'bg', label: 'Bulgarian' },
  { value: 'ca', label: 'Catalan' },
  { value: 'ar-EG', label: 'Arabic (Egypt)' },
  { value: 'ar-JO', label: 'Arabic (Jordan)' },
  { value: 'ar-KW', label: 'Arabic (Kuwait)' },
  { value: 'ar-LB', label: 'Arabic (Lebanon)' },
  { value: 'ar-QA', label: 'Arabic (Qatar)' },
  { value: 'ar-AE', label: 'Arabic (UAE)' },
  { value: 'ar-MA', label: 'Arabic (Morocco)' },
  { value: 'ar-IQ', label: 'Arabic (Iraq)' },
  { value: 'ar-DZ', label: 'Arabic (Algeria)' },
  { value: 'ar-BH', label: 'Arabic (Bahrain)' },
  { value: 'ar-LY', label: 'Arabic (Libya)' },
  { value: 'ar-OM', label: 'Arabic (Oman)' },
  { value: 'ar-SA', label: 'Arabic (Saudi Arabia)' },
  { value: 'ar-TN', label: 'Arabic (Tunisia)' },
  { value: 'ar-YE', label: 'Arabic (Yemen)' },
  { value: 'cs', label: 'Czech' },
  { value: 'nl-NL', label: 'Dutch' },
  { value: 'en-AU', label: 'English (Australia)' },
  { value: 'en-CA', label: 'English (Canada)' },
  { value: 'en-IN', label: 'English (India)' },
  { value: 'en-NZ', label: 'English (New Zealand)' },
  { value: 'en-ZA', label: 'English (South Africa)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'et-EE', label: 'Estonian' },
  { value: 'fi', label: 'Finnish' },
  { value: 'fr-FR', label: 'French' },
  { value: 'gl', label: 'Galician' },
  { value: 'de-DE', label: 'German' },
  { value: 'el-GR', label: 'Greek' },
  { value: 'he', label: 'Hebrew' },
  { value: 'hu', label: 'Hungarian' },
  { value: 'is', label: 'Icelandic' },
  { value: 'it-IT', label: 'Italian' },
  { value: 'id', label: 'Indonesian' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'la', label: 'Latin' },
  { value: 'lv-LV', label: 'Latvian' },
  { value: 'lt-LT', label: 'Lithuanian' },
  { value: 'zh-CN', label: 'Mandarin Chinese' },
  { value: 'zh-TW', label: 'Taiwanese' },
  { value: 'zh-HK', label: 'Cantonese' },
  { value: 'ms-MY', label: 'Malaysian' },
  { value: 'no-NO', label: 'Norwegian' },
  { value: 'pl', label: 'Polish' },
  { value: 'xx-piglatin', label: 'Pig Latin', displayTag: null },
  { value: 'pt-PT', label: 'Portuguese' },
  { value: 'pt-br', label: 'Portuguese (Brasil)' },
  { value: 'ro-RO', label: 'Romanian' },
  { value: 'ru', label: 'Russian' },
  { value: 'sr-SP', label: 'Serbian', displayTag: 'sr' },
  { value: 'sk', label: 'Slovak' },
  { value: 'es-AR', label: 'Spanish (Argentina)' },
  { value: 'es-BO', label: 'Spanish (Bolivia)' },
  { value: 'es-CL', label: 'Spanish (Chile)' },
  { value: 'es-CO', label: 'Spanish (Colombia)' },
  { value: 'es-CR', label: 'Spanish (Costa Rica)' },
  { value: 'es-DO', label: 'Spanish (Dominican Republic)' },
  { value: 'es-EC', label: 'Spanish (Ecuador)' },
  { value: 'es-SV', label: 'Spanish (El Salvador)' },
  { value: 'es-GT', label: 'Spanish (Guatemala)' },
  { value: 'es-HN', label: 'Spanish (Honduras)' },
  { value: 'es-MX', label: 'Spanish (Mexico)' },
  { value: 'es-NI', label: 'Spanish (Nicaragua)' },
  { value: 'es-PA', label: 'Spanish (Panama)' },
  { value: 'es-PY', label: 'Spanish (Paraguay)' },
  { value: 'es-PE', label: 'Spanish (Peru)' },
  { value: 'es-PR', label: 'Spanish (Puerto Rico)' },
  { value: 'es-ES', label: 'Spanish (Spain)' },
  { value: 'es-US', label: 'Spanish (US)' },
  { value: 'es-UY', label: 'Spanish (Uruguay)' },
  { value: 'es-VE', label: 'Spanish (Venezuela)' },
  { value: 'sv-SE', label: 'Swedish' },
  { value: 'tr', label: 'Turkish' },
  { value: 'zu', label: 'Zulu' },
];

/** The speech language a UI language implies when the user has not chosen one. Only
 *  languages listed here change behaviour; every other UI language keeps the old
 *  "let the browser/provider decide" default (an empty string). */
const UI_LANGUAGE_SPEECH_DEFAULTS: Record<string, string> = {
  fa: 'fa-IR',
};

const primaryLanguage = (tag?: string | null): string =>
  (tag ?? '').trim().split(/[-_]/)[0].toLowerCase();

/** The default speech language for a UI language, or '' to leave it to the engine. */
export const defaultSpeechLanguage = (uiLanguage?: string | null): string =>
  UI_LANGUAGE_SPEECH_DEFAULTS[primaryLanguage(uiLanguage)] ?? '';

/** The speech language actually used: the user's own choice, else the UI default. */
export const resolveSpeechLanguage = (saved?: string | null, uiLanguage?: string | null): string =>
  saved != null && saved !== '' ? saved : defaultSpeechLanguage(uiLanguage);

/** Whether a voice/recognition tag speaks the given language (by primary subtag). */
export const speechLanguageMatches = (tag?: string | null, language?: string | null): boolean => {
  const want = primaryLanguage(language);
  return want !== '' && primaryLanguage(tag) === want;
};

const displayNamesCache = new Map<string, Intl.DisplayNames | null>();

const displayNamesFor = (uiLanguage?: string | null): Intl.DisplayNames | null => {
  const key = uiLanguage && uiLanguage !== 'auto' ? uiLanguage : '';
  if (displayNamesCache.has(key)) {
    return displayNamesCache.get(key) ?? null;
  }
  let names: Intl.DisplayNames | null = null;
  try {
    if (typeof Intl.DisplayNames === 'function') {
      names = new Intl.DisplayNames(key ? [key] : undefined, {
        type: 'language',
        fallback: 'none',
      });
    }
  } catch {
    names = null;
  }
  displayNamesCache.set(key, names);
  return names;
};

/** A language tag's name in the UI language, falling back to the given English label. */
export const localizedLanguageName = (
  option: SpeechLanguageOption,
  uiLanguage?: string | null,
): string => {
  if (option.displayTag === null) {
    return option.label;
  }
  const names = displayNamesFor(uiLanguage);
  if (names == null) {
    return option.label;
  }
  try {
    const name = names.of(option.displayTag ?? option.value);
    return name != null && name !== '' ? name : option.label;
  } catch {
    return option.label;
  }
};

/** The STT language in effect: the saved `languageSTT`, else the UI language's default. */
export function useEffectiveLanguageSTT(): string {
  const languageSTT = useRecoilValue<string>(store.languageSTT);
  const uiLanguage = useRecoilValue<string>(store.lang);
  return useMemo(() => resolveSpeechLanguage(languageSTT, uiLanguage), [languageSTT, uiLanguage]);
}

/** The TTS language in effect: the saved `languageTTS`, else the UI language's default. */
export function useEffectiveLanguageTTS(): string {
  const languageTTS = useRecoilValue<string>(store.languageTTS);
  const uiLanguage = useRecoilValue<string>(store.lang);
  return useMemo(() => resolveSpeechLanguage(languageTTS, uiLanguage), [languageTTS, uiLanguage]);
}
