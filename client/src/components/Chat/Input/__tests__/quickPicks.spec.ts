import type { TModelSpec } from 'librechat-data-provider';
import { resolveQuickPicks } from '../quickPicks';

const spec = (name: string, label = name): TModelSpec =>
  ({
    name,
    label,
    preset: { endpoint: 'OpenRouter', model: name },
  }) as TModelSpec;

describe('resolveQuickPicks', () => {
  it('returns nothing when config or list is empty', () => {
    expect(resolveQuickPicks(undefined, [spec('a')])).toEqual([]);
    expect(resolveQuickPicks([{ id: 'daily', specs: ['a'] }], undefined)).toEqual([]);
    expect(resolveQuickPicks([], [spec('a')])).toEqual([]);
    expect(resolveQuickPicks([{ id: 'daily', specs: ['a'] }], [])).toEqual([]);
  });

  it('keeps config order and drops unknown names', () => {
    const list = [spec('economy', 'DeepSeek Flash'), spec('claude-fable', 'Claude Fable')];
    expect(
      resolveQuickPicks(
        [
          { id: 'strongest', specs: ['claude-fable', 'gpt-astra'] },
          { id: 'daily', specs: ['economy', 'fast'] },
        ],
        list,
      ),
    ).toEqual([
      { id: 'strongest', specs: [list[1]] },
      { id: 'daily', specs: [list[0]] },
    ]);
  });

  it('omits a group whose specs are all missing', () => {
    expect(
      resolveQuickPicks(
        [
          { id: 'strongest', specs: ['missing'] },
          { id: 'daily', specs: ['economy'] },
        ],
        [spec('economy')],
      ),
    ).toEqual([{ id: 'daily', specs: [spec('economy')] }]);
  });
});
