import {
  SPEECH_LANGUAGES,
  defaultSpeechLanguage,
  localizedLanguageName,
  resolveSpeechLanguage,
  speechLanguageMatches,
} from '../speechLanguage';

describe('speechLanguage', () => {
  it('lists Persian first', () => {
    expect(SPEECH_LANGUAGES[0].value).toBe('fa-IR');
  });

  it('defaults to fa-IR for a Persian UI and leaves other UIs to the engine', () => {
    expect(defaultSpeechLanguage('fa-IR')).toBe('fa-IR');
    expect(defaultSpeechLanguage('fa')).toBe('fa-IR');
    expect(defaultSpeechLanguage('en-US')).toBe('');
    expect(defaultSpeechLanguage(undefined)).toBe('');
  });

  it('keeps an explicit choice over the UI default', () => {
    expect(resolveSpeechLanguage('en-GB', 'fa-IR')).toBe('en-GB');
    expect(resolveSpeechLanguage('', 'fa-IR')).toBe('fa-IR');
  });

  it('matches voices by primary language', () => {
    expect(speechLanguageMatches('fa-IR', 'fa')).toBe(true);
    expect(speechLanguageMatches('fa_IR', 'fa-IR')).toBe(true);
    expect(speechLanguageMatches('en-US', 'fa-IR')).toBe(false);
    expect(speechLanguageMatches('en-US', '')).toBe(false);
  });

  it('names languages in the UI language, with the English label as fallback', () => {
    const persian = SPEECH_LANGUAGES[0];
    expect(localizedLanguageName(persian, 'en-US')).toMatch(/Persian/);
    const pigLatin = SPEECH_LANGUAGES.find((o) => o.value === 'xx-piglatin')!;
    expect(localizedLanguageName(pigLatin, 'fa-IR')).toBe('Pig Latin');
  });
});
