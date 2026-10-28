import {
  sniffAudioType,
  speechErrorKey,
  primeAudioElement,
  prefersServerSpeech,
  readSpeechErrorCode,
  toSpeechRouteFields,
  voiceDescriptionKey,
  isLocalSpeechConversation,
} from '../speech';

const serverSpeech = {
  localEndpoints: ['Local', 'LocalUncensored'],
  privateEndpoints: ['OpenRouterPrivate'],
};

describe('speech routing on the client', () => {
  it('treats the on-server model as local by endpoint, spec privacy or spec preset', () => {
    expect(isLocalSpeechConversation({ endpoint: 'Local' }, serverSpeech)).toBe(true);
    expect(isLocalSpeechConversation({ endpoint: 'OpenRouter' }, serverSpeech)).toBe(false);
    expect(
      isLocalSpeechConversation({ endpoint: 'OpenRouter', spec: 'mine' }, serverSpeech, [
        { name: 'mine', privacy: 'local' },
      ]),
    ).toBe(true);
    expect(
      isLocalSpeechConversation({ spec: 'preset' }, serverSpeech, [
        { name: 'preset', preset: { endpoint: 'LocalUncensored' } },
      ]),
    ).toBe(true);
    expect(isLocalSpeechConversation(null, serverSpeech)).toBe(false);
  });

  it('sends only what identifies the conversation', () => {
    expect(toSpeechRouteFields({ conversationId: 'new', endpoint: 'OpenRouter' })).toEqual({
      endpoint: 'OpenRouter',
    });
    expect(toSpeechRouteFields({ conversationId: 'c1', spec: 's' })).toEqual({
      conversationId: 'c1',
      spec: 's',
    });
  });

  it('prefers server speech for a Persian UI only', () => {
    expect(prefersServerSpeech('fa-IR')).toBe(true);
    expect(prefersServerSpeech('fa')).toBe(true);
    expect(prefersServerSpeech('en-US')).toBe(false);
  });
});

describe('speech errors and audio', () => {
  it('reads the code from JSON and arraybuffer responses', () => {
    expect(readSpeechErrorCode({ response: { data: { code: 'too_large' } } })).toBe('too_large');
    const buffer = new TextEncoder().encode('{"code":"local_route"}').buffer;
    expect(readSpeechErrorCode({ response: { data: buffer } })).toBe('local_route');
    expect(readSpeechErrorCode(new Error('x'))).toBeUndefined();
  });

  it('maps codes to localized keys with a generic fallback', () => {
    expect(speechErrorKey('insufficient_balance')).toBe('com_ui_speech_error_balance');
    expect(speechErrorKey('route_not_configured')).toBe('com_ui_speech_error_unavailable');
    expect(speechErrorKey('something_new')).toBe('com_ui_speech_error_generic');
    expect(speechErrorKey(undefined)).toBe('com_ui_speech_error_generic');
  });

  it('detects WAV answers', () => {
    expect(sniffAudioType(new TextEncoder().encode('RIFF....WAVE').buffer)).toBe('audio/wav');
    expect(sniffAudioType(new Uint8Array([0xff, 0xfb, 0x90, 0x00]).buffer)).toBe('audio/mpeg');
  });

  it('describes known server voices', () => {
    expect(voiceDescriptionKey('Kore')).toBe('com_nav_voice_female');
    expect(voiceDescriptionKey('Charon')).toBe('com_nav_voice_male');
    expect(voiceDescriptionKey('alloy')).toBeUndefined();
  });

  it('primes an audio element once, inside the tap (iOS autoplay)', () => {
    const play = jest.fn(() => Promise.resolve());
    const element = { dataset: {} as DOMStringMap, src: '', play, pause: jest.fn() };
    primeAudioElement(element as unknown as HTMLAudioElement);
    primeAudioElement(element as unknown as HTMLAudioElement);

    expect(play).toHaveBeenCalledTimes(1);
    expect(element.src.startsWith('data:audio/wav;base64,')).toBe(true);
  });
});
