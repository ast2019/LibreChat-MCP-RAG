import { formatModelName } from '../name';

describe('formatModelName', () => {
  it.each([
    ['openai/gpt-6.1-sol', 'GPT-6.1 Sol'],
    ['anthropic/claude-sonnet-5.5', 'Claude Sonnet 5.5'],
    ['anthropic/claude-sonnet-4-5', 'Claude Sonnet 4.5'],
    ['~anthropic/claude-sonnet-latest', 'Claude Sonnet Latest'],
    ['google/gemini-3.8-flash', 'Gemini 3.8 Flash'],
    ['openai/gpt-4o-mini', 'GPT-4o Mini'],
    ['openai/o3-mini', 'o3 Mini'],
    ['meta-llama/llama-3.1-70b-instruct', 'Llama 3.1 70B Instruct'],
    ['deepseek/deepseek-v3', 'DeepSeek V3'],
    ['openai/gpt-oss-120b:free', 'GPT-OSS 120B'],
    ['hivegpt-uncensored', 'Hivegpt Uncensored'],
  ])('%s → %s', (id, name) => {
    expect(formatModelName(id)).toBe(name);
  });

  it('returns the id itself when nothing readable remains', () => {
    expect(formatModelName('vendor/')).toBe('vendor/');
  });
});
