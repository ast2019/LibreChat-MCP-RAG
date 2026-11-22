import {
  maskShareLogText,
  selectShareLogLines,
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
    await handlers.fetchShare(
      { params: { code: 'not-a-real-code-value!!' } } as never,
      res as never,
    );
    expect(res.statusCode).toBe(404);
  });
});

describe('debug share logs', () => {
  const now = Date.parse('2026-11-14T12:00:00.000Z');
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

  it('masks tokens, emails and IP addresses but keeps times and ids', () => {
    const text = maskShareLogText(
      '[Login] [Login failed] [Username: ali@example.com] [User ID: 65f0c2a1b2c3d4e5f6a7b8c9] ' +
        '[Request-IP: ::ffff:10.0.4.17] at 12:33:28 Bearer abc.def.ghi 2001:db8:85a3:0:0:8a2e:370:7334',
    );
    expect(text).not.toContain('ali@example.com');
    expect(text).not.toContain('10.0.4.17');
    expect(text).toContain('10.0.x.x');
    expect(text).not.toContain('abc.def.ghi');
    expect(text).not.toContain('8a2e:370:7334');
    expect(text).toContain('12:33:28');
    expect(text).toContain('65f0c2a1b2c3d4e5f6a7b8c9');
  });

  it('merges both sources once, keeps the window, the newest lines and oldest-first order', () => {
    const shared = { at: at(5), level: 'error', message: 'both' };
    const logs = selectShareLogLines(
      {
        debug: [{ at: at(10), level: 'info', message: 'info line' }, shared],
        problems: [
          { at: at(500), level: 'error', message: 'too old' },
          shared,
          { at: at(1), level: 'warn', message: 'late' },
        ],
      },
      { now, maxLines: 2 },
    );
    expect(logs.total).toBe(3);
    expect(logs.sources).toEqual(['debug', 'problems']);
    expect(logs.lines.map((line) => line.message)).toEqual(['both', 'late']);
  });
});

describe('debug share live read', () => {
  it('rebuilds the snapshot on each read and keeps the minted expiry', async () => {
    let version = 1;
    const handlers = createDebugShareHandlers({
      store: createMemoryDebugShareStore(),
      buildSnapshot: async () => ({ notes: [`v${version}`] }),
    });
    const minted = mockRes();
    await handlers.mintShare({ body: {} } as never, minted as never);
    const { code, expiresAt } = minted.body as { code: string; expiresAt: string };
    version = 2;
    const read = mockRes();
    await handlers.fetchShare({ params: { code } } as never, read as never);
    expect(read.body).toMatchObject({ notes: ['v2'], expiresAt });
  });
});

describe('maskShareLogText stack frames', () => {
  it('keeps stack frames readable, including scoped package paths', () => {
    const frames = [
      'at foo (file:///x.js:1:2)',
      'at Object.<anonymous> (file:///app/node_modules/@remotion/renderer/dist/a.js:10:5)',
      '    at async renderJob (file:///app/src/server.mjs:42:7)',
      'at x (/app/node_modules/@librechat/api/dist/index.js:1:2)',
      'at /app/node_modules/@scope/pkg/index.js:3:4',
      'at y (C:\\app\\node_modules\\@scope\\pkg\\a.js:5:6)',
    ];
    for (const frame of frames) {
      expect(maskShareLogText(frame)).toBe(frame);
    }
  });

  it('still masks real emails, also next to a frame or inside a path', () => {
    expect(maskShareLogText('login failed for a.b@example.com at foo (file:///x.js:1:2)')).toBe(
      'login failed for [REDACTED_EMAIL] at foo (file:///x.js:1:2)',
    );
    expect(maskShareLogText('at z (/home/john@example.com/app.js:1:2)')).not.toContain('john@example.com');
    expect(maskShareLogText('contact jöhn@example.com')).toBe('contact [REDACTED_EMAIL]');
  });

  it('still redacts a token inside a path-like frame', () => {
    const key = `sk-${'a1B2c3D4e5'.repeat(4)}`;
    for (const line of [`at /v1/keys/${key}:443`, `at fetch (/v1/keys/${key}:443)`]) {
      expect(maskShareLogText(line)).not.toContain(key);
    }
  });
});
