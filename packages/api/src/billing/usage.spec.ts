import { TIME_METER_CONTEXT } from 'librechat-data-provider';
import type { TimePackEntitlement } from 'librechat-data-provider';
import type { RecordUsageDeps } from '~/agents/usage';
import { partitionTimePackUsage, collectAgentEndpoints, recordTimePackUsage } from './usage';

const entitlement: TimePackEntitlement = {
  timePackId: 'claude-time',
  timePackEndpoint: 'ClaudeTime',
  timePackExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
};

const claude = {
  input_tokens: 1000,
  output_tokens: 100,
  model: 'claude-sonnet-5-5',
  agentId: 'main',
};
const subagent = {
  input_tokens: 500,
  output_tokens: 50,
  model: 'gpt-5',
  agentId: 'helper',
  usage_type: 'subagent' as const,
};
const summary = {
  input_tokens: 300,
  output_tokens: 30,
  model: 'gemini-flash',
  usage_type: 'summarization' as const,
};

function createDeps() {
  const insertMany = jest.fn().mockResolvedValue(undefined);
  const updateBalance = jest.fn().mockResolvedValue(undefined);
  const deps: RecordUsageDeps = {
    spendTokens: jest.fn(),
    spendStructuredTokens: jest.fn(),
    pricing: { getMultiplier: () => 1, getCacheMultiplier: () => null },
    bulkWriteOps: { insertMany, updateBalance },
  };
  return { deps, insertMany, updateBalance };
}

describe('partitionTimePackUsage (F3)', () => {
  const scope = {
    entitlement,
    defaultEndpoint: { endpoint: 'OpenRouter' },
    agentEndpoints: new Map([
      ['main', { endpoint: 'ClaudeTime', provider: 'anthropic' }],
      ['helper', { endpoint: 'OpenRouter', provider: 'openrouter' }],
    ]),
  };

  it('charges a row that reports another provider than its endpoint', () => {
    const summarization = { ...summary, provider: 'google' };
    expect(
      partitionTimePackUsage([summarization], {
        entitlement,
        defaultEndpoint: { endpoint: 'ClaudeTime', provider: 'anthropic' },
      }).metered,
    ).toEqual([]);
  });

  it('meters only the time-pack endpoint and charges other agents and models', () => {
    expect(partitionTimePackUsage([claude, subagent, summary], scope)).toEqual({
      metered: [claude],
      charged: [subagent, summary],
    });
  });

  it('charges usage of an agent the run does not list', () => {
    expect(partitionTimePackUsage([{ ...claude, agentId: 'unknown' }], scope).metered).toEqual([]);
  });

  it('meters a title on the time-pack endpoint by the recording model', () => {
    const title = { input_tokens: 20, output_tokens: 5 };
    expect(
      partitionTimePackUsage(
        [title],
        { entitlement, defaultEndpoint: { endpoint: 'ClaudeTime' } },
        'claude-sonnet-5-5',
      ).metered,
    ).toEqual([title]);
  });

  it('charges everything without an entitlement', () => {
    expect(partitionTimePackUsage([claude], { ...scope, entitlement: null }).metered).toEqual([]);
  });
});

describe('recordTimePackUsage (F3)', () => {
  const params = {
    user: 'u1',
    conversationId: 'c1',
    model: 'claude-sonnet-5-5',
    balance: { enabled: true },
    transactions: { enabled: true },
  };
  const scope = {
    entitlement,
    defaultEndpoint: { endpoint: 'ClaudeTime', provider: 'anthropic' },
    agentEndpoints: new Map([
      ['main', { endpoint: 'ClaudeTime', provider: 'anthropic' }],
      ['helper', { endpoint: 'OpenRouter', provider: 'openrouter' }],
    ]),
  };

  it('charges the subagent and summarization rows and meters only the Claude row', async () => {
    const { deps, insertMany, updateBalance } = createDeps();
    const meter = jest.fn().mockResolvedValue(undefined);

    const result = await recordTimePackUsage(
      deps,
      { ...params, collectedUsage: [claude, subagent, { ...summary, agentId: 'helper' }] },
      { scope, meter },
    );

    const docs = insertMany.mock.calls.flatMap(([rows]) => rows);
    const contexts = docs.map((doc: { model: string; context: string }) => [
      doc.model,
      doc.context,
    ]);
    expect(contexts).toEqual(
      expect.arrayContaining([
        ['gpt-5', 'subagent'],
        ['gemini-flash', 'summarization'],
        ['claude-sonnet-5-5', TIME_METER_CONTEXT],
      ]),
    );
    expect(
      contexts.filter(([model]: string[]) => model === 'claude-sonnet-5-5').map(([, c]) => c),
    ).toEqual([TIME_METER_CONTEXT, TIME_METER_CONTEXT]);
    expect(updateBalance).toHaveBeenCalledTimes(1);
    expect(meter).toHaveBeenCalledTimes(1);
    expect(meter.mock.calls[0][0]).toBeGreaterThan(0);
    /** Same totals recordCollectedUsage reports for the whole turn: subagent output excluded. */
    expect(result).toEqual({ input_tokens: 1000, output_tokens: 130 });
  });

  it('records exactly as before when nothing is covered', async () => {
    const { deps, updateBalance } = createDeps();
    const meter = jest.fn();
    await recordTimePackUsage(
      deps,
      { ...params, collectedUsage: [subagent] },
      { scope: { ...scope, entitlement: null }, meter },
    );
    expect(updateBalance).toHaveBeenCalledTimes(1);
    expect(meter).not.toHaveBeenCalled();
  });
});

describe('collectAgentEndpoints', () => {
  it('keeps the configured endpoint and the SDK provider of each agent', () => {
    expect(
      collectAgentEndpoints([
        { id: 'main', endpoint: 'ClaudeTime', provider: 'anthropic' },
        { id: 'raw', provider: 'OpenRouter' },
        null,
      ]),
    ).toEqual(
      new Map([
        ['main', { endpoint: 'ClaudeTime', provider: 'anthropic' }],
        ['raw', { endpoint: 'OpenRouter', provider: 'OpenRouter' }],
      ]),
    );
  });
});
