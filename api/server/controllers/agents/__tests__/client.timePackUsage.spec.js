const mockInsertMany = jest.fn().mockResolvedValue(undefined);
const mockUpdateBalance = jest.fn().mockResolvedValue(undefined);
const mockAddTimePackMeteredCredits = jest.fn().mockResolvedValue(undefined);

jest.mock('~/models', () => ({
  initializeMessageBudget: jest.fn(),
  spendTokens: jest.fn(),
  spendStructuredTokens: jest.fn(),
  getMultiplier: () => 1,
  getCacheMultiplier: () => null,
  bulkInsertTransactions: (...args) => mockInsertMany(...args),
  updateBalance: (...args) => mockUpdateBalance(...args),
}));

jest.mock('@librechat/data-schemas', () => ({
  logger: { debug: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

jest.mock('@librechat/api', () => ({
  ...jest.requireActual('@librechat/api'),
  addTimePackMeteredCredits: (...args) => mockAddTimePackMeteredCredits(...args),
}));

const { TIME_METER_CONTEXT } = require('librechat-data-provider');
const AgentClient = require('../client');

const entitlement = {
  timePackId: 'claude-time',
  timePackEndpoint: 'ClaudeTime',
  timePackExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
};

/** A client whose turn ran a ClaudeTime primary agent and an OpenRouter subagent. */
function createClient(req) {
  const agent = {
    id: 'main',
    endpoint: 'ClaudeTime',
    provider: 'anthropic',
    model_parameters: { model: 'claude-sonnet-5-5' },
  };
  return Object.create(AgentClient.prototype, {
    user: { value: 'user-1' },
    conversationId: { value: 'convo-1' },
    responseMessageId: { value: 'msg-1' },
    agentConfigs: {
      value: new Map([
        ['helper', { id: 'helper', endpoint: 'OpenRouter', provider: 'openrouter' }],
      ]),
    },
    usage: { value: undefined, writable: true },
    options: {
      value: {
        req: { user: { id: 'user-1' }, config: { balance: { enabled: true } }, ...req },
        agent,
        endpoint: 'ClaudeTime',
        endpointTokenConfig: undefined,
      },
    },
  });
}

const contexts = () =>
  mockInsertMany.mock.calls.flatMap(([docs]) => docs).map((doc) => [doc.model, doc.context]);

describe('AgentClient#recordCollectedUsage on the unlimited Claude plan (F3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('meters the ClaudeTime usage and charges the subagent on another endpoint', async () => {
    const client = createClient({ _timePackEntitlement: entitlement, _timePackSeatHeld: true });

    await client.recordCollectedUsage({
      collectedUsage: [
        { input_tokens: 100, output_tokens: 10, model: 'claude-sonnet-5-5', agentId: 'main' },
        {
          input_tokens: 50,
          output_tokens: 5,
          model: 'gpt-5',
          agentId: 'helper',
          usage_type: 'subagent',
        },
      ],
      balance: { enabled: true },
      transactions: { enabled: true },
    });

    expect(contexts()).toEqual(
      expect.arrayContaining([
        ['gpt-5', 'subagent'],
        ['claude-sonnet-5-5', TIME_METER_CONTEXT],
      ]),
    );
    expect(mockUpdateBalance).toHaveBeenCalledTimes(1);
    expect(mockAddTimePackMeteredCredits).toHaveBeenCalledWith(
      'user-1',
      expect.any(Number),
      undefined,
    );
  });

  it('meters a title generated after the seat was released', async () => {
    const req = { _timePackEntitlement: entitlement, _timePackSeatHeld: false };
    const client = createClient(req);

    await client.recordCollectedUsage({
      collectedUsage: [{ input_tokens: 20, output_tokens: 4 }],
      context: 'title',
      model: 'claude-sonnet-5-5',
      usageEndpoint: 'ClaudeTime',
      timePackEntitlement: req._timePackEntitlement,
      balance: { enabled: true },
      transactions: { enabled: true },
    });

    expect(contexts()).toEqual([
      ['claude-sonnet-5-5', TIME_METER_CONTEXT],
      ['claude-sonnet-5-5', TIME_METER_CONTEXT],
    ]);
    expect(mockUpdateBalance).not.toHaveBeenCalled();
  });

  it('charges everything without a time-pack entitlement', async () => {
    const client = createClient({});

    await client.recordCollectedUsage({
      collectedUsage: [
        { input_tokens: 100, output_tokens: 10, model: 'claude-sonnet-5-5', agentId: 'main' },
      ],
      balance: { enabled: true },
      transactions: { enabled: true },
    });

    expect(contexts().every(([, context]) => context !== TIME_METER_CONTEXT)).toBe(true);
    expect(mockUpdateBalance).toHaveBeenCalledTimes(1);
    expect(mockAddTimePackMeteredCredits).not.toHaveBeenCalled();
  });
});
