import type { AppConfig } from '@librechat/data-schemas';
import {
  filterModelsForTimePack,
  hasActiveTimePack,
  isTimePackFamilyModel,
  timePackEndpointNames,
} from './timePack';

const FUTURE = '2099-01-01T00:00:00.000Z';
const PAST = '2020-01-01T00:00:00.000Z';

describe('timePackEndpointNames', () => {
  it('collects the endpoints of the time packs only', () => {
    const config = {
      balance: {
        packs: [
          { kind: 'time', id: 'tp1', durationDays: 30, endpoint: 'ClaudeTime' },
          { kind: 'credit', id: 'cp1', credits: 100 },
        ],
      },
    } as unknown as AppConfig;

    expect(timePackEndpointNames(config)).toEqual(['ClaudeTime']);
  });

  it('returns nothing when the config has no time pack', () => {
    const config = {
      balance: { packs: [{ kind: 'credit', id: 'cp1', credits: 100 }] },
    } as unknown as AppConfig;

    expect(timePackEndpointNames(config)).toEqual([]);
  });
});

describe('hasActiveTimePack', () => {
  it('is true while the entitlement has not expired', () => {
    expect(
      hasActiveTimePack({
        timePackId: 'tp1',
        timePackExpiresAt: FUTURE,
        timePackEndpoint: 'ClaudeTime',
      }),
    ).toBe(true);
  });

  it('is false once the entitlement has expired', () => {
    expect(
      hasActiveTimePack({
        timePackId: 'tp1',
        timePackExpiresAt: PAST,
        timePackEndpoint: 'ClaudeTime',
      }),
    ).toBe(false);
  });

  it('is false without an entitlement', () => {
    expect(hasActiveTimePack(null)).toBe(false);
    expect(hasActiveTimePack({})).toBe(false);
  });
});

describe('isTimePackFamilyModel', () => {
  it('matches the Claude family, with or without a provider prefix', () => {
    expect(isTimePackFamilyModel('anthropic/claude-sonnet-4.5')).toBe(true);
    expect(isTimePackFamilyModel('claude-3-5-sonnet')).toBe(true);
  });

  it('does not match the other families', () => {
    expect(isTimePackFamilyModel('gpt-4o')).toBe(false);
    expect(isTimePackFamilyModel('openai/gpt-4o')).toBe(false);
    expect(isTimePackFamilyModel('deepseek/chat')).toBe(false);
  });
});

describe('filterModelsForTimePack', () => {
  const timePackEndpoints = new Set(['ClaudeTime']);

  it('keeps the credit-path Claude models for a user without the plan', () => {
    const models = ['anthropic/claude-sonnet-4.5', 'gpt-4o'];

    expect(
      filterModelsForTimePack(models, {
        endpointName: 'openrouter',
        timePackEndpoints,
        active: false,
      }),
    ).toEqual(models);
  });

  it('drops the credit-path Claude models for a holder of the plan', () => {
    const models = ['anthropic/claude-sonnet-4.5', 'gpt-4o'];

    expect(
      filterModelsForTimePack(models, {
        endpointName: 'openrouter',
        timePackEndpoints,
        active: true,
      }),
    ).toEqual(['gpt-4o']);
  });

  it('keeps the plan endpoint’s own list untouched', () => {
    const models = ['claude-sonnet-4.5', 'claude-opus-4.1'];

    expect(
      filterModelsForTimePack(models, {
        endpointName: 'ClaudeTime',
        timePackEndpoints,
        active: true,
      }),
    ).toEqual(models);
  });
});
