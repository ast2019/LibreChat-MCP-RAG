import winston from 'winston';
import type { DebugTraceAppend } from '@librechat/data-schemas';
import type { Request, Response } from 'express';
import type { DebugModeStore, StoredDebugMode } from './mode';
import {
  debugTrace,
  DebugRecorder,
  getDebugRecorder,
  compactStageData,
  runWithDebugRecorder,
} from './recorder';
import { createDebugTraceMiddleware, summarizeChatRequest, DEBUG_TRACE_HEADER } from './middleware';
import { createDebugCaptureTransport, SystemLogBuffer, followDebugLevel } from './capture';
import { createDebugMode, clampDebugMinutes } from './mode';
import { createDebugAdminHandlers } from './admin';

function memoryStore() {
  let value: StoredDebugMode | undefined;
  const store: DebugModeStore & { raw: () => StoredDebugMode | undefined } = {
    get: jest.fn(async () => value),
    set: jest.fn(async (next: StoredDebugMode) => {
      value = next;
    }),
    delete: jest.fn(async () => {
      value = undefined;
    }),
    raw: () => value,
  };
  return store;
}

function sink() {
  const calls: DebugTraceAppend[] = [];
  return {
    calls,
    appendDebugTrace: jest.fn(async (input: DebugTraceAppend) => void calls.push(input)),
  };
}

function mockRes() {
  const res = {
    statusCode: 200,
    headersSent: false,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    listeners: {} as Record<string, () => void>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    once(event: string, fn: () => void) {
      this.listeners[event] = fn;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return res;
}

describe('debug mode', () => {
  it('is off until enabled, then turns itself off when its window ends', async () => {
    let now = 1_000_000;
    const store = memoryStore();
    const mode = createDebugMode({ store, now: () => now });
    expect((await mode.getState()).enabled).toBe(false);

    const on = await mode.enable({ minutes: 15, level: 'info', by: 'admin@x.com' });
    expect(on).toMatchObject({ enabled: true, enabledBy: 'admin@x.com', level: 'info' });
    expect(store.set).toHaveBeenCalledWith(expect.any(Object), 15 * 60_000);
    expect(mode.isActiveNow()).toBe(true);

    now += 15 * 60_000;
    expect(mode.isActiveNow()).toBe(false);
    expect((await mode.getState()).enabled).toBe(false);
  });

  it('clamps the window and notifies listeners on change', async () => {
    const mode = createDebugMode({ store: memoryStore() });
    const listener = jest.fn();
    mode.onChange(listener);
    await mode.enable({ minutes: 10_000, by: 'a' });
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true, level: 'debug' }),
    );
    await mode.disable();
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
    expect(clampDebugMinutes(10_000)).toBe(240);
    expect(clampDebugMinutes(undefined)).toBe(30);
    expect(clampDebugMinutes(0)).toBe(1);
  });

  it('reads another replica\u2019s switch after the refresh interval', async () => {
    let now = 0;
    const store = memoryStore();
    const mode = createDebugMode({ store, now: () => now });
    await mode.getState();
    await store.set({ enabledUntil: now + 60_000, enabledBy: 'b', level: 'warn' }, 60_000);
    expect((await mode.getState()).enabled).toBe(false);
    now += 6_000;
    expect((await mode.getState()).enabled).toBe(true);
  });
});

describe('debug recorder', () => {
  it('does nothing outside a traced request', () => {
    expect(() => debugTrace('stage', { a: 1 })).not.toThrow();
    expect(getDebugRecorder()).toBeUndefined();
  });

  it('collects stages and log lines from async work and writes them in one flush', async () => {
    const out = sink();
    const recorder = new DebugRecorder(out, { userId: 'u1', endpoint: 'openAI' });
    await runWithDebugRecorder(recorder, async () => {
      debugTrace('one', { tools: ['a'] });
      await Promise.resolve();
      debugTrace('two', () => ({ lazy: true }));
      getDebugRecorder()?.log({ at: new Date(), level: 'error', message: 'boom' });
      getDebugRecorder()?.update({ conversationId: 'c1', status: 200 });
    });
    await recorder.flush();
    expect(out.appendDebugTrace).toHaveBeenCalledTimes(1);
    const [input] = out.calls;
    expect(input).toMatchObject({
      traceId: recorder.traceId,
      userId: 'u1',
      endpoint: 'openAI',
      conversationId: 'c1',
      status: 200,
      errors: 1,
      warnings: 0,
    });
    expect(input.stages?.map((stage) => stage.name)).toEqual(['one', 'two']);
    expect(input.stages?.[1].data).toEqual({ lazy: true });
    await recorder.flush();
    expect(out.appendDebugTrace).toHaveBeenCalledTimes(1);
  });

  it('flushes outside the trace, so a failed write is not recorded into it', async () => {
    const appendDebugTrace = jest.fn(async () => {
      expect(getDebugRecorder()).toBeUndefined();
      throw new Error('mongo down');
    });
    const onError = jest.fn();
    const recorder = new DebugRecorder({ appendDebugTrace }, {}, onError);
    runWithDebugRecorder(recorder, () => debugTrace('x'));
    await recorder.flush();
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('keeps stage data JSON-safe and bounded', () => {
    const cyclic: Record<string, unknown> = { set: new Set([1]), map: new Map([['k', 2]]) };
    cyclic.self = cyclic;
    expect(compactStageData(cyclic)).toEqual({ set: [1], map: { k: 2 }, self: '[circular]' });
    const big = compactStageData({ text: 'x'.repeat(20_000) }) as { truncated: boolean };
    expect(big.truncated).toBe(true);
  });
});

describe('debug capture', () => {
  const makeLogger = (mode: ReturnType<typeof createDebugMode>, buffer: SystemLogBuffer) =>
    winston.createLogger({
      level: 'silly',
      transports: [createDebugCaptureTransport(mode, buffer)],
    });

  it('captures nothing while debug mode is off', async () => {
    const mode = createDebugMode({ store: memoryStore() });
    const buffer = new SystemLogBuffer();
    makeLogger(mode, buffer).error('ignored');
    expect(buffer.size).toBe(0);
  });

  it('captures lines at or above the level into the buffer and the current trace', async () => {
    const mode = createDebugMode({ store: memoryStore() });
    await mode.enable({ minutes: 5, level: 'warn', by: 'a' });
    const buffer = new SystemLogBuffer();
    const log = makeLogger(mode, buffer);
    const out = sink();
    const recorder = new DebugRecorder(out, {});
    runWithDebugRecorder(recorder, () => {
      log.warn('tool missing', { tool: 'browser_open' });
      log.info('too chatty');
    });
    log.error('outside');
    const { lines } = buffer.snapshot();
    expect(lines.map((line) => line.message)).toEqual(['tool missing', 'outside']);
    expect(lines[0].traceId).toBe(recorder.traceId);
    expect(lines[0].meta).toContain('browser_open');
    expect(lines[1].traceId).toBeUndefined();
    await recorder.flush();
    expect(out.calls[0].warnings).toBe(1);
  });

  it('drops the oldest lines past capacity', () => {
    const buffer = new SystemLogBuffer(2);
    for (const message of ['a', 'b', 'c']) {
      buffer.push({ at: '', level: 'warn', message });
    }
    expect(buffer.snapshot()).toEqual({
      lines: [expect.objectContaining({ message: 'b' }), expect.objectContaining({ message: 'c' })],
      dropped: 1,
    });
  });

  it('raises the logger level only while on, and restores it', () => {
    const target = { level: 'warn' };
    const follow = followDebugLevel(target);
    follow({ enabled: true, enabledUntil: 'x', enabledBy: 'a', level: 'debug' });
    expect(target.level).toBe('debug');
    follow({ enabled: false, enabledUntil: null, enabledBy: null, level: 'warn' });
    expect(target.level).toBe('warn');
    follow({ enabled: true, enabledUntil: 'x', enabledBy: 'a', level: 'error' });
    expect(target.level).toBe('warn');
  });
});

describe('debug trace middleware', () => {
  const chatReq = (body: Record<string, unknown>) =>
    ({
      method: 'POST',
      originalUrl: '/api/agents/chat/openAI',
      body,
      user: { id: 'u1', role: 'ADMIN' },
    }) as unknown as Request;

  it('summarizes the request without its text', () => {
    const summary = summarizeChatRequest(
      chatReq({
        text: 'secret words',
        endpoint: 'openAI',
        ephemeralAgent: { browser: true, mcp: ['x'] },
      }) as never,
    );
    expect(summary).toMatchObject({
      endpoint: 'openAI',
      textChars: 12,
      ephemeralAgent: { browser: true, mcp: ['x'] },
    });
    expect(JSON.stringify(summary)).not.toContain('secret');
  });

  it('passes straight through while debug mode is off', async () => {
    const out = sink();
    const middleware = createDebugTraceMiddleware({
      debugMode: createDebugMode({ store: memoryStore() }),
      sink: out,
    });
    const next = jest.fn(() => getDebugRecorder());
    const res = mockRes();
    await middleware(chatReq({}) as never, res as unknown as Response, next);
    expect(next).toHaveBeenCalled();
    expect(next.mock.results[0].value).toBeUndefined();
    expect(res.headers[DEBUG_TRACE_HEADER]).toBeUndefined();
  });

  it('runs the rest of the request inside a trace while on', async () => {
    const mode = createDebugMode({ store: memoryStore() });
    await mode.enable({ minutes: 5, by: 'a' });
    const out = sink();
    const middleware = createDebugTraceMiddleware({ debugMode: mode, sink: out });
    let recorder: DebugRecorder | undefined;
    const res = mockRes();
    await middleware(
      chatReq({ endpoint: 'openAI', model: 'gpt' }) as never,
      res as unknown as Response,
      () => {
        recorder = getDebugRecorder();
        debugTrace('inner');
      },
    );
    expect(recorder).toBeDefined();
    expect(res.headers[DEBUG_TRACE_HEADER]).toBe(recorder?.traceId);
    res.listeners.finish();
    await recorder?.flush();
    expect(out.calls[0]).toMatchObject({
      userId: 'u1',
      endpoint: 'openAI',
      model: 'gpt',
      status: 200,
    });
    expect(out.calls[0].stages?.map((stage) => stage.name)).toEqual([
      'request',
      'inner',
      'response',
    ]);
  });
});

describe('debug admin handlers', () => {
  const traces = {
    listDebugTraces: jest.fn(async () => ({ total: 0, entries: [] })),
    getDebugTrace: jest.fn(async () => null),
    clearDebugTraces: jest.fn(async () => 3),
  };

  it('validates the switch body and turns debug mode on and off', async () => {
    const mode = createDebugMode({ store: memoryStore() });
    const handlers = createDebugAdminHandlers({
      debugMode: mode,
      traces,
      getSystemLog: () => ({ lines: [], dropped: 0 }),
    });
    const bad = mockRes();
    await handlers.updateDebugMode(
      { body: { enabled: 'yes' } } as never,
      bad as unknown as Response,
    );
    expect(bad.statusCode).toBe(400);

    const badLevel = mockRes();
    await handlers.updateDebugMode(
      { body: { enabled: true, level: 'loud' } } as never,
      badLevel as unknown as Response,
    );
    expect(badLevel.statusCode).toBe(400);

    const on = mockRes();
    await handlers.updateDebugMode(
      { body: { enabled: true, minutes: 15 }, user: { id: 'a1', email: 'a@x.com' } } as never,
      on as unknown as Response,
    );
    expect(on.body).toMatchObject({ enabled: true, enabledBy: 'a@x.com', systemLogLines: 0 });

    const off = mockRes();
    await handlers.updateDebugMode(
      { body: { enabled: false }, user: { id: 'a1' } } as never,
      off as unknown as Response,
    );
    expect(off.body).toMatchObject({ enabled: false });
  });

  it('clamps paging and answers 404 for an unknown trace', async () => {
    const handlers = createDebugAdminHandlers({
      debugMode: createDebugMode({ store: memoryStore() }),
      traces,
      getSystemLog: () => ({ lines: [], dropped: 0 }),
    });
    const list = mockRes();
    await handlers.listTraces(
      { query: { limit: '500', offset: '-3', problems: 'true' } } as unknown as Request,
      list as unknown as Response,
    );
    expect(traces.listDebugTraces).toHaveBeenCalledWith({
      search: undefined,
      problems: true,
      limit: 100,
      offset: 0,
    });
    const missing = mockRes();
    await handlers.getTrace(
      { params: { id: 'nope' } } as unknown as Request,
      missing as unknown as Response,
    );
    expect(missing.statusCode).toBe(404);
  });
});
