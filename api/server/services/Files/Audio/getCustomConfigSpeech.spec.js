jest.mock('@librechat/data-schemas', () => ({ logger: { error: jest.fn() } }));
jest.mock('~/server/services/Config', () => ({ getAppConfig: jest.fn() }));

const getCustomConfigSpeech = require('./getCustomConfigSpeech');

const createResponse = () => {
  const res = {
    send: jest.fn(),
    status: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
};

describe('getCustomConfigSpeech', () => {
  it.each(['openai', 'azureOpenAI'])(
    'normalizes the legacy STT provider "%s" to the external engine',
    async (engineSTT) => {
      const req = {
        config: {
          speech: {
            stt: { openai: {} },
            speechTab: { speechToText: { engineSTT } },
          },
        },
      };
      const res = createResponse();

      await getCustomConfigSpeech(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith({
        sttExternal: true,
        ttsExternal: false,
        engineSTT: 'external',
      });
    },
  );

  it.each(['browser', 'external'])('preserves the runtime STT engine "%s"', async (engineSTT) => {
    const req = {
      config: {
        speech: {
          stt: { openai: {} },
          speechTab: { speechToText: { engineSTT } },
        },
      },
    };
    const res = createResponse();

    await getCustomConfigSpeech(req, res);

    expect(res.send).toHaveBeenCalledWith(expect.objectContaining({ engineSTT }));
  });

  it.each(['openai', 'azureOpenAI', 'elevenlabs', 'localai'])(
    'normalizes the legacy TTS provider "%s" to the external engine',
    async (engineTTS) => {
      const req = {
        config: {
          speech: {
            tts: { openai: {} },
            speechTab: { textToSpeech: { engineTTS } },
          },
        },
      };
      const res = createResponse();

      await getCustomConfigSpeech(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith({
        sttExternal: false,
        ttsExternal: true,
        engineTTS: 'external',
      });
    },
  );

  it.each(['browser', 'external'])('preserves the runtime TTS engine "%s"', async (engineTTS) => {
    const req = {
      config: {
        speech: {
          tts: { openai: {} },
          speechTab: { textToSpeech: { engineTTS } },
        },
      },
    };
    const res = createResponse();

    await getCustomConfigSpeech(req, res);

    expect(res.send).toHaveBeenCalledWith(expect.objectContaining({ engineTTS }));
  });

  it('reports the hive server speech block the client routes and labels by', async () => {
    const res = createResponse();

    await getCustomConfigSpeech(
      {
        config: {
          endpoints: {
            custom: [{ name: 'OpenRouter', apiKey: 'k', baseURL: 'https://openrouter.ai/api/v1' }],
          },
          speech: {
            stt: {
              hive: { public: { endpoint: 'OpenRouter', model: 'google/gemini-3.5-transcribe' } },
            },
            tts: {
              hive: { public: { endpoint: 'OpenRouter', model: 'google/gemini-3.8-flash-tts' } },
            },
          },
        },
      },
      res,
    );

    const settings = res.send.mock.calls[0][0];
    expect(settings).toMatchObject({ sttExternal: true, ttsExternal: true });
    expect(settings.serverSpeech).toEqual({
      stt: { language: 'fa', maxDurationSeconds: 120, private: false },
      tts: { voices: ['Kore', 'Charon', 'Leda', 'Puck'], private: false },
      localEndpoints: ['Local', 'LocalUncensored', 'LocalUncensoredThink'],
      privateEndpoints: ['OpenRouterPrivate'],
    });
    /* Credentials and model ids stay on the server. */
    expect(JSON.stringify(settings)).not.toContain('gemini');
  });
});
