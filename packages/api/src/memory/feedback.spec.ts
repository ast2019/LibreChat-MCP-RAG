import type { IUser } from '@librechat/data-schemas';
import type { TMinimalFeedback } from 'librechat-data-provider';
import type { FeedbackMemoryDeps } from './feedback';
import { checkAccess } from '../middleware/access';
import { formatFeedbackLine, learnFromFeedback } from './feedback';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

jest.mock('../middleware/access', () => ({ checkAccess: jest.fn() }));

const mockCheckAccess = checkAccess as jest.MockedFunction<typeof checkAccess>;

const user = { id: 'user-1', role: 'USER' } as unknown as IUser;
const down: TMinimalFeedback = { rating: 'thumbsDown', tag: 'inaccurate', text: ' cite  sources ' };
const memory = {
  learnFromFeedback: true,
  tokenLimit: 100,
  charLimit: 10000,
  validKeys: ['profile', 'preferences'],
  excludeEndpoints: ['Local'],
};

type Stored = { key: string; value: string; tokenCount?: number };

function makeDeps(stored: Stored[] = []) {
  const setMemory = jest.fn().mockResolvedValue({ ok: true });
  const deps = {
    getUserMemories: jest.fn().mockResolvedValue(stored),
    setMemory,
    getRoleByName: jest.fn(),
    countTokens: (value: string) => value.length,
  } as unknown as FeedbackMemoryDeps;
  return { deps, setMemory };
}

describe('formatFeedbackLine', () => {
  it('states the rating and tag, then the reason on one line', () => {
    expect(formatFeedbackLine(down)).toBe('- Disliked (inaccurate): cite sources');
    expect(
      formatFeedbackLine({ rating: 'thumbsUp', tag: 'accurate_reliable', text: 'tables' }),
    ).toBe('- Liked (accurate_reliable): tables');
    expect(formatFeedbackLine({ rating: 'thumbsDown', tag: 'inaccurate' })).toBeNull();
  });
});

describe('learnFromFeedback', () => {
  beforeEach(() => {
    mockCheckAccess.mockReset().mockResolvedValue(true);
  });

  it('adds the reason to the preferences memory, after what is there', async () => {
    const { deps, setMemory } = makeDeps([
      { key: 'preferences', value: 'Prefers Persian', tokenCount: 15 },
    ]);
    const outcome = await learnFromFeedback(deps, { user, config: { memory }, feedback: down });
    expect(outcome).toBe('saved');
    const value = 'Prefers Persian\n- Disliked (inaccurate): cite sources';
    expect(setMemory).toHaveBeenCalledWith({
      userId: 'user-1',
      key: 'preferences',
      value,
      tokenCount: value.length,
    });
    expect(mockCheckAccess).toHaveBeenCalledWith(
      expect.objectContaining({ permissions: ['USE', 'CREATE', 'UPDATE'] }),
    );
  });

  it('keeps a line once', async () => {
    const { deps, setMemory } = makeDeps([
      { key: 'preferences', value: '- Disliked (inaccurate): Cite sources.', tokenCount: 38 },
    ]);
    expect(await learnFromFeedback(deps, { user, config: { memory }, feedback: down })).toBe(
      'duplicate',
    );
    expect(setMemory).not.toHaveBeenCalled();
  });

  it('writes nothing past the token limit, counting the other memories', async () => {
    const { deps, setMemory } = makeDeps([{ key: 'profile', value: 'x', tokenCount: 90 }]);
    expect(await learnFromFeedback(deps, { user, config: { memory }, feedback: down })).toBe(
      'full',
    );
    expect(setMemory).not.toHaveBeenCalled();
  });

  it.each([
    ['learning is off', { config: { memory: { ...memory, learnFromFeedback: false } } }],
    ['memory is disabled', { config: { memory: { ...memory, disabled: true } } }],
    ['there is no reason', { feedback: { rating: 'thumbsDown', tag: 'inaccurate' } }],
    ['the answer came from an excluded endpoint', { endpoint: 'local' }],
    [
      'preferences is not a valid key',
      { config: { memory: { ...memory, validKeys: ['profile'] } } },
    ],
    [
      'the user turned memory off',
      { user: { ...user, personalization: { memories: false } } as unknown as IUser },
    ],
  ])('skips when %s', async (_case, overrides) => {
    const { deps, setMemory } = makeDeps();
    const outcome = await learnFromFeedback(deps, {
      user,
      config: { memory },
      feedback: down,
      ...(overrides as object),
    });
    expect(outcome).toBe('skipped');
    expect(setMemory).not.toHaveBeenCalled();
  });

  it('skips without the memory write permissions', async () => {
    mockCheckAccess.mockResolvedValue(false);
    const { deps, setMemory } = makeDeps();
    expect(await learnFromFeedback(deps, { user, config: { memory }, feedback: down })).toBe(
      'skipped',
    );
    expect(setMemory).not.toHaveBeenCalled();
  });

  it('lets a database failure reach the caller', async () => {
    const { deps } = makeDeps();
    (deps.getUserMemories as jest.Mock).mockRejectedValue(new Error('down'));
    await expect(
      learnFromFeedback(deps, { user, config: { memory }, feedback: down }),
    ).rejects.toThrow('down');
  });
});
