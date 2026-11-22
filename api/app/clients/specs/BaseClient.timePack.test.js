const { Run } = require('@librechat/agents');
const { HumanMessage } = require('@librechat/agents/langchain/messages');
const { EModelEndpoint } = require('librechat-data-provider');
const { initializeFakeClient } = require('./FakeClient');

jest.mock('~/db/connect');
jest.mock('~/server/services/Config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({ paths: { uploads: '/tmp' }, fileStrategy: 'local' }),
}));
jest.mock('~/cache', () => ({
  ...jest.requireActual('~/cache'),
  logViolation: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('~/models', () => ({
  getMessages: jest.fn().mockResolvedValue([]),
  saveMessage: jest.fn(),
  updateMessage: jest.fn(),
  getConvo: jest.fn(),
  saveConvo: jest.fn(),
  stampConvoLastResponse: jest.fn(),
  getFiles: jest.fn(),
  getMultiplier: jest.fn().mockReturnValue(1),
  getCacheMultiplier: jest.fn().mockReturnValue(null),
  reserveBalance: jest.fn(),
  renewBalanceReservation: jest.fn().mockResolvedValue(undefined),
  releaseBalanceReservation: jest.fn().mockResolvedValue(undefined),
  getRoleByName: jest.fn(),
  getFormattedMemories: jest
    .fn()
    .mockResolvedValue({ withKeys: '', withoutKeys: '', totalTokens: 0 }),
  getUserMemories: jest.fn().mockResolvedValue([]),
  setMemory: jest.fn(),
  deleteMemory: jest.fn(),
}));
jest.mock('@librechat/api', () => ({
  ...jest.requireActual('@librechat/api'),
  checkAccess: jest.fn().mockResolvedValue(true),
  /** The real tokenizer loads its encoding through a dynamic import jest cannot run. */
  countTokens: jest.fn(async (text = '') => Math.ceil(text.length / 4)),
  /** The memory agent as initialization returns it: on its own (ZDR) endpoint. */
  initializeAgent: jest.fn(async ({ agent }) => ({
    ...agent,
    endpoint: agent.provider,
    instructions: 'Remember stable facts.',
    model_parameters: { model: agent.model },
  })),
}));

const { reserveBalance } = require('~/models');
const AgentClient = require('~/server/controllers/agents/client');

const entitlement = {
  timePackId: 'claude-time',
  timePackEndpoint: 'ClaudeTime',
  timePackExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
};

describe('BaseClient on a time-pack turn with balance enabled', () => {
  let client;
  let memoryRun;

  beforeEach(() => {
    jest.clearAllMocks();
    client = initializeFakeClient('key', { modelOptions: { model: 'claude-sonnet-5-5' } }, []);
    client.options.endpoint = EModelEndpoint.agents;
    client.options.agent = {
      id: 'main',
      endpoint: 'ClaudeTime',
      provider: 'anthropic',
      model_parameters: { model: 'claude-sonnet-5-5' },
    };
    client.options.req = {
      user: { id: 'user-1', role: 'USER' },
      body: {},
      _timePackEntitlement: entitlement,
      _timePackSeatHeld: true,
      config: {
        balance: { enabled: true },
        memory: {
          agent: { enabled: true, provider: 'OpenRouterPrivate', model: 'google/gemini-3.8-flash' },
        },
      },
    };
    client.options.res = {};
    client.buildMessages.mockReturnValue({ prompt: [], tokenCountMap: { res: 50 } });
    client.getTokenCountForResponse = jest.fn().mockReturnValue(50);
    client.recordTokenUsage = jest.fn().mockResolvedValue(undefined);
    /** The agent run: the covered Claude call, then the memory agent on another endpoint. */
    client.sendCompletion.mockImplementation(async function () {
      await AgentClient.prototype.useMemory.call(this);
      await AgentClient.prototype.runMemory.call(this, [new HumanMessage('I teach physics.')]);
      return { completion: 'Mock response text', metadata: undefined };
    });
    client.filterImageUrls = AgentClient.prototype.filterImageUrls;
    memoryRun = jest
      .spyOn(Run, 'create')
      .mockResolvedValue({ processStream: jest.fn().mockResolvedValue([]) });
  });

  afterEach(() => {
    memoryRun.mockRestore();
  });

  it('does not run the off-pack memory model unpaid when the user has no credits', async () => {
    reserveBalance.mockResolvedValue({ reserved: false, balance: 0 });

    await client.sendMessage('Hello', {});

    /** The covered Claude call ran without a credit check... */
    expect(client.sendCompletion).toHaveBeenCalledTimes(1);
    /** ...but the memory model was checked against the empty balance and never invoked. */
    expect(memoryRun).not.toHaveBeenCalled();
    expect(reserveBalance).toHaveBeenCalledTimes(1);
  });

  it('runs the memory model once its credits are reserved', async () => {
    reserveBalance.mockResolvedValue({ reserved: true, balance: 1000 });

    await client.sendMessage('Hello', {});

    expect(reserveBalance).toHaveBeenCalledTimes(1);
    expect(memoryRun).toHaveBeenCalledTimes(1);
  });

  describe('with a handoff agent on another endpoint', () => {
    beforeEach(() => {
      client.sendCompletion = AgentClient.prototype.sendCompletion;
      client.chatCompletion = jest.fn().mockResolvedValue(undefined);
      client.isCompactionTurn = () => false;
      client.buildResponseMetadata = () => undefined;
      client.contentParts = [{ type: 'text', text: 'Mock response text' }];
    });

    it('refuses the turn with token_balance before the run starts, as for a normal user', async () => {
      client.agentConfigs = new Map([
        [
          'helper',
          { id: 'helper', endpoint: 'OpenRouter', provider: 'openrouter', model: 'gpt-5' },
        ],
      ]);
      reserveBalance.mockResolvedValue({ reserved: false, balance: 0 });

      await expect(client.sendMessage('Hello', {})).rejects.toThrow('token_balance');

      expect(client.chatCompletion).not.toHaveBeenCalled();
    });

    it('starts a run of covered agents without a credit check', async () => {
      client.agentConfigs = new Map();

      await client.sendMessage('Hello', {});

      expect(client.chatCompletion).toHaveBeenCalledTimes(1);
      expect(reserveBalance).not.toHaveBeenCalled();
    });
  });

  it('runs the memory model unchecked when balance is disabled', async () => {
    client.options.req.config.balance = { enabled: false };

    await client.sendMessage('Hello', {});

    expect(reserveBalance).not.toHaveBeenCalled();
    expect(memoryRun).toHaveBeenCalledTimes(1);
  });
});
