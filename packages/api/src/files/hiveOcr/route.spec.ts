import { resolveOcrRoute, resolveUploadOcrRoute, strictestOcrRoute } from './route';

const specs = [
  { name: 'gemini', preset: { endpoint: 'OpenRouter' } },
  { name: 'private-fast', privacy: 'private' as const, preset: { endpoint: 'OpenRouterPrivate' } },
  { name: 'local', privacy: 'local' as const, preset: { endpoint: 'Local' } },
  /** A private spec whose preset names a public endpoint: privacy still decides. */
  { name: 'odd-private', privacy: 'private' as const, preset: { endpoint: 'OpenRouter' } },
];

const context = {
  specs,
  localEndpoints: ['Local', 'LocalUncensored', 'LocalUncensoredThink'],
  privateEndpoints: ['OpenRouterPrivate'],
};

describe('resolveOcrRoute', () => {
  it.each([
    [{ endpoint: 'OpenRouter' }, 'public'],
    [{ endpoint: 'OpenRouter', spec: 'gemini' }, 'public'],
    [{ endpoint: 'OpenRouterPrivate' }, 'private'],
    [{ endpoint: 'OpenRouter', spec: 'private-fast' }, 'private'],
    [{ endpoint: 'OpenRouter', spec: 'odd-private' }, 'private'],
    [{ endpoint: 'Local' }, 'local'],
    [{ endpoint: 'LocalUncensored' }, 'local'],
    [{ endpoint: 'LocalUncensoredThink' }, 'local'],
    [{ endpoint: 'OpenRouter', spec: 'local' }, 'local'],
    [{ spec: 'local' }, 'local'],
    [{}, 'public'],
  ] as const)('%j → %s', (source, expected) => {
    expect(resolveOcrRoute(source, context)).toBe(expected);
  });

  it('keeps a private endpoint private when the spec is unknown', () => {
    expect(resolveOcrRoute({ endpoint: 'OpenRouterPrivate', spec: 'gone' }, context)).toBe(
      'private',
    );
  });

  it('works without a spec list', () => {
    expect(
      resolveOcrRoute({ endpoint: 'Local', spec: 'local' }, { ...context, specs: undefined }),
    ).toBe('local');
  });
});

describe('strictestOcrRoute', () => {
  it('orders local > private > public', () => {
    expect(strictestOcrRoute('public', 'private')).toBe('private');
    expect(strictestOcrRoute('private', 'public')).toBe('private');
    expect(strictestOcrRoute('private', 'local')).toBe('local');
    expect(strictestOcrRoute('local', 'public')).toBe('local');
  });
});

describe('resolveUploadOcrRoute', () => {
  it('uses the request for a new conversation', () => {
    expect(
      resolveUploadOcrRoute({ ...context, requested: { endpoint: 'OpenRouter', spec: 'local' } }),
    ).toBe('local');
  });

  it('never downgrades a stored private conversation to public', () => {
    expect(
      resolveUploadOcrRoute({
        ...context,
        requested: { endpoint: 'OpenRouter', spec: 'gemini' },
        stored: { endpoint: 'OpenRouterPrivate', spec: 'private-fast' },
      }),
    ).toBe('private');
  });

  it('never downgrades a stored local conversation', () => {
    expect(
      resolveUploadOcrRoute({
        ...context,
        requested: { endpoint: 'OpenRouterPrivate', spec: 'private-fast' },
        stored: { endpoint: 'Local', spec: 'local' },
      }),
    ).toBe('local');
  });

  it('lets the request make a stored public conversation stricter', () => {
    expect(
      resolveUploadOcrRoute({
        ...context,
        requested: { endpoint: 'Local', spec: 'local' },
        stored: { endpoint: 'OpenRouter', spec: 'gemini' },
      }),
    ).toBe('local');
  });
});
