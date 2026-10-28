import type { Response } from 'express';
import type { HiveSpeechService, SynthesizeOutcome } from './service';
import type { ServerRequest } from '~/types';
import { createHiveSpeechHttp, readSpeechRouteFields } from './http';
import { SpeechError } from './types';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));

function makeRes() {
  const res = {
    headersSent: false,
    setHeader: jest.fn(),
    status: jest.fn(),
    json: jest.fn(),
    end: jest.fn(),
    write: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

const outcome = (audio = Buffer.from('RIFFwav')): SynthesizeOutcome => ({
  audio,
  contentType: 'audio/wav',
  route: 'public',
  voice: 'Kore',
  billed: Promise.resolve(1),
});

function makeService(synthesize: HiveSpeechService['synthesize']): HiveSpeechService {
  return {
    synthesize,
    transcribe: jest.fn(),
    resolveRoute: jest.fn(),
    getVoices: () => ['Kore'],
  };
}

const req = (body: Record<string, unknown>) =>
  ({ body, user: { id: 'u' }, on: jest.fn() }) as unknown as ServerRequest;

describe('hive speech HTTP', () => {
  it('reads only bounded string route fields', () => {
    expect(
      readSpeechRouteFields({ conversationId: 'c1', endpoint: 'X'.repeat(300), spec: 3 }),
    ).toEqual({ conversationId: 'c1', endpoint: undefined, spec: undefined });
  });

  it('writes WAV audio with its type', async () => {
    const synthesize = jest.fn(async () => outcome());
    const http = createHiveSpeechHttp(makeService(synthesize));
    const res = makeRes();

    await http.respondTextToSpeech(
      req({ voice: 'Kore', conversationId: 'c1' }),
      res as unknown as Response,
      'سلام',
    );

    expect(synthesize).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'سلام', voice: 'Kore', fields: { conversationId: 'c1' } }),
    );
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'audio/wav');
    expect(res.end).toHaveBeenCalledWith(Buffer.from('RIFFwav'));
  });

  it('answers a failure with its stable code only', async () => {
    const synthesize = jest.fn(async () => {
      throw new SpeechError('provider_failed', 'upstream said: secret');
    });
    const http = createHiveSpeechHttp(makeService(synthesize));
    const res = makeRes();

    await http.respondTextToSpeech(req({}), res as unknown as Response, 'سلام');

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({ code: 'provider_failed' });
  });

  it('collects the streamed message until it finishes, then speaks it once', async () => {
    const synthesize = jest.fn(async () => outcome());
    const http = createHiveSpeechHttp(makeService(synthesize));
    const res = makeRes();
    const nextUpdates = jest
      .fn()
      .mockResolvedValueOnce([{ text: 'سلام.', isFinished: false }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ text: 'خداحافظ.', isFinished: true }]);

    await http.respondStreamAudio(
      req({ conversationId: 'c1' }),
      res as unknown as Response,
      nextUpdates,
      0,
    );

    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(synthesize).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'سلام. خداحافظ.', fields: { conversationId: 'c1' } }),
    );
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'audio/wav');
  });
});
