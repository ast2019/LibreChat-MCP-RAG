import {
  createDebugShareHandlers,
  createMemoryDebugShareStore,
  DEBUG_SHARE_DEFAULT_TTL_MS,
} from './share';

function mockRes() {
  const res: {
    statusCode: number;
    body: unknown;
    status: (code: number) => typeof res;
    json: (body: unknown) => typeof res;
  } = {
    statusCode: 200,
    body: null,
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

describe('debug share', () => {
  it('mints a code and returns the sanitized snapshot once', async () => {
    const store = createMemoryDebugShareStore();
    const handlers = createDebugShareHandlers({
      store,
      buildSnapshot: async () => ({
        appVersion: '0.38.9',
        notes: ['sanitized'],
        codeBridge: { configured: true, healthOk: true, statusCode: 200 },
      }),
      publicBaseUrl: () => 'https://chat.example.com',
    });

    const mintRes = mockRes();
    await handlers.mintShare({ body: {}, user: { id: 'admin1' } } as never, mintRes as never);
    expect(mintRes.statusCode).toBe(201);
    const minted = mintRes.body as { code: string; url: string; expiresAt: string };
    expect(minted.code.length).toBeGreaterThan(16);
    expect(minted.url).toContain(minted.code);

    const fetchRes = mockRes();
    await handlers.fetchShare({ params: { code: minted.code } } as never, fetchRes as never);
    expect(fetchRes.statusCode).toBe(200);
    const snap = fetchRes.body as { appVersion: string; notes: string[] };
    expect(snap.appVersion).toBe('0.38.9');
    expect(snap.notes).toContain('sanitized');
  });

  it('rejects expired or unknown codes', async () => {
    const store = createMemoryDebugShareStore();
    const handlers = createDebugShareHandlers({
      store,
      buildSnapshot: async () => ({ notes: [] }),
      defaultTtlMs: DEBUG_SHARE_DEFAULT_TTL_MS,
    });
    const res = mockRes();
    await handlers.fetchShare({ params: { code: 'not-a-real-code-value!!' } } as never, res as never);
    expect(res.statusCode).toBe(404);
  });
});
