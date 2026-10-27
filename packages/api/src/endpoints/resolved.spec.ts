import { captureResolvedModel, createResolvedModelRegistry } from './resolved';

describe('createResolvedModelRegistry', () => {
  it('keeps the latest concrete id per alias and ignores identical ids', () => {
    const registry = createResolvedModelRegistry();
    registry.record('~a/x-latest', 'a/x-1');
    registry.record('~a/x-latest', 'a/x-2');
    registry.record('a/concrete', 'a/concrete');
    registry.record(undefined, 'a/y');
    expect(registry.get('~a/x-latest')).toBe('a/x-2');
    expect(registry.get('a/concrete')).toBeUndefined();
  });

  it('drops the least recently updated alias beyond its bound', () => {
    const registry = createResolvedModelRegistry({ maxEntries: 2 });
    registry.record('one', 'one-1');
    registry.record('two', 'two-1');
    registry.record('one', 'one-2');
    registry.record('three', 'three-1');
    expect(registry.get('two')).toBeUndefined();
    expect(registry.get('one')).toBe('one-2');
    expect(registry.get('three')).toBe('three-1');
  });
});

describe('captureResolvedModel', () => {
  it('records the answering model against its requested id and returns it', () => {
    const registry = createResolvedModelRegistry();
    const resolved = captureResolvedModel(
      [{ model: '~anthropic/claude-sonnet-latest', resolved_model: 'anthropic/claude-sonnet-5.5' }],
      registry,
    );
    expect(resolved).toBe('anthropic/claude-sonnet-5.5');
    expect(registry.get('~anthropic/claude-sonnet-latest')).toBe('anthropic/claude-sonnet-5.5');
  });

  it('records nothing when no call reported a model', () => {
    const registry = createResolvedModelRegistry();
    expect(captureResolvedModel([{ model: '~a/x-latest' }], registry)).toBeUndefined();
    expect(registry.get('~a/x-latest')).toBeUndefined();
  });
});
