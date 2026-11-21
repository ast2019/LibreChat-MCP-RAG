import type { AppConfig } from '@librechat/data-schemas';
import { applyTimePackSpecs } from './admin';

const config = {
  modelSpecs: {
    list: [
      { name: 'smart', group: 'Claude', preset: { endpoint: 'OpenRouter' } },
      { name: 'gpt', group: 'ChatGPT', preset: { endpoint: 'OpenRouter' } },
      {
        name: 'time-smart',
        group: 'Claude',
        timePack: true,
        preset: { endpoint: 'ClaudeTime' },
      },
    ],
  },
} as AppConfig;

describe('applyTimePackSpecs', () => {
  it('hides time-pack specs without an entitlement', () => {
    const filtered = applyTimePackSpecs(config, false);
    expect(filtered.modelSpecs?.list?.map((spec) => spec.name)).toEqual(['smart', 'gpt']);
  });

  it('shows time-pack Claude and hides credit Claude while active', () => {
    const filtered = applyTimePackSpecs(config, true);
    expect(filtered.modelSpecs?.list?.map((spec) => spec.name)).toEqual(['gpt', 'time-smart']);
  });
});
