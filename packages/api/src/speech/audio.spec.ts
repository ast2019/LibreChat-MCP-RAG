import type { AppConfig } from '@librechat/data-schemas';
import { getServerSpeechClientConfig, resolveSpeechEndpoint } from './config';
import { audioFormat, pcmToWav, pcmSeconds, splitSpeechText } from './audio';
import { usdToCredits, estimateRecordingSeconds } from './pricing';
import { toSpeechLanguage, pickVoice } from './service';

describe('speech audio helpers', () => {
  it('maps browser recording types to transcription formats', () => {
    expect(audioFormat('audio/webm;codecs=opus')).toBe('webm');
    expect(audioFormat('audio/mp4')).toBe('m4a');
    expect(audioFormat('audio/ogg;codecs=opus')).toBe('ogg');
    expect(audioFormat('application/octet-stream', 'take.wav')).toBe('wav');
    expect(audioFormat('text/plain', 'a.wav')).toBeUndefined();
  });

  it('wraps PCM in a valid WAV header', () => {
    const wav = pcmToWav(Buffer.alloc(100), 24000);
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readUInt32LE(40)).toBe(100);
    expect(pcmSeconds(48000, 24000)).toBe(1);
  });

  it('splits long Persian text at sentence ends within the limit', () => {
    const sentence = 'این یک جملهٔ نمونه است؟ ';
    const pieces = splitSpeechText(sentence.repeat(20), 100);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(100);
      expect(piece.endsWith('؟')).toBe(true);
    }
  });

  it('prices like chat: USD × multiplier × 1,000,000', () => {
    expect(usdToCredits(0.001, 1.3)).toBeCloseTo(1300, 6);
    expect(estimateRecordingSeconds(1_000_000, 120)).toBe(120);
    expect(estimateRecordingSeconds(20_000, 120)).toBe(10);
  });

  it('normalizes languages and voices', () => {
    expect(toSpeechLanguage('fa-IR')).toBe('fa');
    expect(toSpeechLanguage('xx-piglatin')).toBe('xx');
    expect(toSpeechLanguage('')).toBeUndefined();
    expect(pickVoice(['Kore', 'Puck'], 'Puck')).toBe('Puck');
    expect(pickVoice(['Kore', 'Puck'], 'alloy')).toBe('Kore');
  });
});

describe('speech config', () => {
  const appConfig = {
    endpoints: {
      custom: [
        { name: 'OpenRouter', apiKey: 'k', baseURL: 'https://openrouter.ai/api/v1' },
        { name: 'Byo', apiKey: 'user_provided', baseURL: 'https://example.com/v1' },
      ],
    },
    speech: {
      stt: { hive: { public: { endpoint: 'OpenRouter', model: 'm' } } },
      tts: { hive: { public: { endpoint: 'OpenRouter', model: 't' }, voices: ['Kore'] } },
    },
  } as unknown as AppConfig;

  it('exposes only what the client needs', () => {
    expect(getServerSpeechClientConfig(appConfig)).toEqual({
      stt: { language: 'fa', maxDurationSeconds: 120, private: false },
      tts: { voices: ['Kore'], private: false },
      localEndpoints: ['Local', 'LocalUncensored', 'LocalUncensoredThink'],
      privateEndpoints: ['OpenRouterPrivate'],
    });
    expect(getServerSpeechClientConfig({} as AppConfig)).toBeUndefined();
  });

  it('never uses user-provided credentials and defaults the multiplier to 1', () => {
    expect(resolveSpeechEndpoint(appConfig, 'OpenRouter')).toMatchObject({ priceMultiplier: 1 });
    expect(resolveSpeechEndpoint(appConfig, 'Byo')).toBeUndefined();
    expect(resolveSpeechEndpoint(appConfig, 'Missing')).toBeUndefined();
  });
});
