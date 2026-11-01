import type { AppConfig } from '@librechat/data-schemas';
import type { ServerRequest } from '~/types/http';
import { TEST_USER_ID, fakeClient, fakeLog, fakeSession } from './testing';
import { createBrowserUserHandlers, readBrowserInput } from './user';
import { BrowserServiceError } from './client';

const response = () => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { res: { status, json, once: jest.fn() } as never, status, json };
};

const request = (overrides: Record<string, unknown> = {}) =>
  ({
    user: { id: TEST_USER_ID, role: 'USER' },
    config: { browser: {} } as unknown as AppConfig,
    params: { id: 's1' },
    ...overrides,
  }) as unknown as ServerRequest;

describe('readBrowserInput', () => {
  it('keeps well-formed input and drops the rest', () => {
    expect(readBrowserInput({ type: 'click', x: 10, y: 20, extra: 1 })).toEqual({
      type: 'click',
      x: 10,
      y: 20,
    });
    expect(readBrowserInput({ type: 'type', text: 'a'.repeat(900) })).toEqual({
      type: 'type',
      text: 'a'.repeat(500),
    });
    expect(readBrowserInput({ type: 'key', key: 'Enter' })).toEqual({ type: 'key', key: 'Enter' });
    expect(readBrowserInput({ type: 'key', key: 'F12' })).toBeNull();
    expect(readBrowserInput({ type: 'click', x: 'a', y: 1 })).toBeNull();
    expect(readBrowserInput({ type: 'eval' })).toBeNull();
  });
});

describe('createBrowserUserHandlers', () => {
  it('shows the user their own browser in the conversation, without the owner id', async () => {
    const client = fakeClient({
      listSessions: jest.fn(async () => [
        fakeSession({ context: 'c1', control: 'user', handoff: { reason: 'login' }, url: 'https://x.ir/' }),
      ]),
    });
    const handlers = createBrowserUserHandlers({ getClient: () => client, log: fakeLog() });
    const { res, json } = response();
    await handlers.getSession(request({ query: { conversationId: 'c1' } }), res);
    expect(client.listSessions).toHaveBeenCalledWith({ owner: TEST_USER_ID, context: 'c1' });
    const { session } = json.mock.calls[0][0];
    expect(session).toMatchObject({ id: 's1', control: 'user', handoff: { reason: 'login' } });
    expect(session).not.toHaveProperty('owner');
  });

  it("answers someone else's browser as not found, for every action", async () => {
    const client = fakeClient({ getSession: jest.fn(async () => fakeSession({ owner: 'someone-else' })) });
    const handlers = createBrowserUserHandlers({ getClient: () => client, log: fakeLog() });
    for (const [handler, body] of [
      [handlers.input, { type: 'key', key: 'Enter' }],
      [handlers.control, { to: 'user' }],
      [handlers.close, undefined],
      [handlers.view, undefined],
    ] as const) {
      const { res, status } = response();
      await handler(request({ body }), res);
      expect(status).toHaveBeenCalledWith(404);
    }
    expect(client.input).not.toHaveBeenCalled();
    expect(client.setControl).not.toHaveBeenCalled();
    expect(client.closeSession).not.toHaveBeenCalled();
    expect(client.frames).not.toHaveBeenCalled();
  });

  it('forwards the owner’s input and maps refusals to codes, never raw messages', async () => {
    const client = fakeClient({
      getSession: jest.fn(async () => fakeSession()),
      input: jest
        .fn()
        .mockResolvedValueOnce({ url: 'https://x.ir/', title: 'X', focus: 'password' })
        .mockRejectedValueOnce(new BrowserServiceError('model_control', 'Take the browser first', 409))
        .mockRejectedValueOnce(new BrowserServiceError('internal', 'stack trace /app/src', 500)),
    });
    const handlers = createBrowserUserHandlers({ getClient: () => client, log: fakeLog() });
    const ok = response();
    await handlers.input(request({ body: { type: 'click', x: 5, y: 6 } }), ok.res);
    expect(ok.json).toHaveBeenCalledWith({ url: 'https://x.ir/', title: 'X', focus: 'password' });
    const busy = response();
    await handlers.input(request({ body: { type: 'click', x: 5, y: 6 } }), busy.res);
    expect(busy.status).toHaveBeenCalledWith(409);
    expect(busy.json).toHaveBeenCalledWith({ error: 'model_control' });
    const broken = response();
    await handlers.input(request({ body: { type: 'click', x: 5, y: 6 } }), broken.res);
    expect(broken.status).toHaveBeenCalledWith(503);
    expect(broken.json).toHaveBeenCalledWith({ error: 'unavailable' });
    const bad = response();
    await handlers.input(request({ body: { type: 'eval', code: 'x' } }), bad.res);
    expect(bad.status).toHaveBeenCalledWith(400);
  });

  it('lets the owner take the browser and give it back, and close it', async () => {
    const log = fakeLog();
    const client = fakeClient({
      getSession: jest.fn(async () => fakeSession()),
      setControl: jest.fn(async () => fakeSession({ control: 'model', handoff: null })),
      closeSession: jest.fn(async () => ({ ...fakeSession(), endedAt: 9, durationMs: 8, reason: 'closed' as const })),
    });
    const handlers = createBrowserUserHandlers({ getClient: () => client, log });
    const given = response();
    await handlers.control(request({ body: { to: 'model' } }), given.res);
    expect(client.setControl).toHaveBeenCalledWith('s1', 'model');
    expect(given.json.mock.calls[0][0].session.control).toBe('model');
    const closed = response();
    await handlers.close(request(), closed.res);
    expect(closed.json).toHaveBeenCalledWith({ closed: true });
    expect(log.recordBrowserSessionEnd).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 's1', reason: 'closed' }),
    );
  });

  it('answers no browser while it is off or not set up', async () => {
    const handlers = createBrowserUserHandlers({ getClient: () => null, log: fakeLog() });
    const { res, json } = response();
    await handlers.getSession(request({ query: { conversationId: 'c1' } }), res);
    expect(json).toHaveBeenCalledWith({ session: null });
    const invalid = response();
    await handlers.getSession(request({ query: { conversationId: '../x' } }), invalid.res);
    expect(invalid.status).toHaveBeenCalledWith(400);
  });
});
