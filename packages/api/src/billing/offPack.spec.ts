import { ViolationTypes } from 'librechat-data-provider';
import { HumanMessage } from '@librechat/agents/langchain/messages';
import { SimpleChatModel } from '@langchain/core/language_models/chat_models';
import { HookRegistry, executeHooks, StreamLimitExceededError } from '@librechat/agents';
import type { TimePackEntitlement } from 'librechat-data-provider';
import type { Response } from 'express';
import type { CheckBalanceDeps } from '~/middleware/checkBalance';
import type { ServerRequest } from '~/types/http';
import {
  admitOffPack,
  admitOffPackLabel,
  withOffPackBalance,
  admitOffPackAgents,
  getOffPackRefusalText,
  createOffPackBalanceGate,
  createSubagentBalanceHook,
  OffPackBalanceRefusalError,
  createOffPackMemoryAdmission,
  createOffPackSummarizationGuard,
} from './offPack';
import { createBalanceReservations } from '~/middleware/checkBalance';
import { collectAgentEndpoints } from './usage';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { debug: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

const entitlement: TimePackEntitlement = {
  timePackId: 'claude-time',
  timePackEndpoint: 'ClaudeTime',
  timePackExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
  models: ['claude-sonnet-5-5'],
};

const claude = {
  id: 'main',
  endpoint: 'ClaudeTime',
  provider: 'anthropic',
  model: 'claude-sonnet-5-5',
};
const helper = { id: 'helper', endpoint: 'OpenRouter', provider: 'openrouter', model: 'gpt-5' };

const req = { user: { id: 'user-1' } } as ServerRequest;
const res = {} as Response;

function createDeps(balance: number): Omit<CheckBalanceDeps, 'balanceConfig'> {
  return {
    getMultiplier: jest.fn().mockReturnValue(1),
    reserveBalance: jest.fn(async ({ amount }) =>
      amount <= balance ? { reserved: true, balance } : { reserved: false, balance },
    ),
    renewBalanceReservation: jest.fn().mockResolvedValue(undefined),
    releaseBalanceReservation: jest.fn().mockResolvedValue(undefined),
    logViolation: jest.fn().mockResolvedValue(undefined),
  };
}

function createGate({
  balance = 0,
  enabled = true,
  withEntitlement = true,
  deps = createDeps(balance),
} = {}) {
  const reservations = createBalanceReservations();
  const gate = createOffPackBalanceGate({
    req,
    res,
    user: 'user-1',
    entitlement: withEntitlement ? entitlement : null,
    balanceConfig: { enabled },
    reservations,
    deps,
    countTokens: (text) => Math.ceil(text.length / 4),
    promptTokens: 120,
  });
  return { gate, deps, reservations };
}

describe('createOffPackBalanceGate', () => {
  it('admits a covered call without a credit check', async () => {
    const { gate, deps } = createGate();

    const admission = await gate.admit({ ...claude, promptTokens: 500 });

    expect(admission).toMatchObject({ ok: true, covered: true });
    expect(deps.reserveBalance).not.toHaveBeenCalled();
  });

  it('refuses an off-pack call the balance cannot cover with token_balance', async () => {
    const { gate, deps } = createGate({ balance: 0 });

    const admission = await gate.admit({ ...helper, promptTokens: 500 });

    expect(admission).toEqual({
      ok: false,
      error: { code: ViolationTypes.TOKEN_BALANCE, message: expect.any(String) },
    });
    expect(admission.ok === false && JSON.parse(admission.error.message)).toMatchObject({
      type: ViolationTypes.TOKEN_BALANCE,
      balance: 0,
    });
    expect(deps.reserveBalance).toHaveBeenCalledWith(expect.objectContaining({ amount: 500 }));
    expect(deps.logViolation).toHaveBeenCalledTimes(1);
  });

  it('holds an admitted off-pack call on the turn reservations until they are released', async () => {
    const { gate, deps, reservations } = createGate({ balance: 1000 });

    const admission = await gate.admit({ ...helper, promptText: 'x'.repeat(40) });

    expect(admission).toMatchObject({ ok: true, covered: false });
    expect(deps.reserveBalance).toHaveBeenCalledWith(expect.objectContaining({ amount: 10 }));
    await reservations.release();
    expect(deps.releaseBalanceReservation).toHaveBeenCalledTimes(1);
  });

  it('reserves at least one token, so an empty balance never admits a call', async () => {
    const { gate } = createGate({ balance: 0 });

    await expect(gate.admit({ ...helper, promptText: '' })).resolves.toMatchObject({ ok: false });
  });

  it('charges a call whose usage is recorded off the pack even on the pack endpoint', async () => {
    const { gate, deps } = createGate({ balance: 0 });

    const admission = await gate.admit({ ...claude, usageEndpoint: null, promptTokens: 10 });

    expect(admission.ok).toBe(false);
    expect(deps.reserveBalance).toHaveBeenCalledTimes(1);
  });

  it('checks a pack-endpoint call on a model outside the pack', async () => {
    const { gate } = createGate({ balance: 0 });

    await expect(
      gate.admit({ ...claude, model: 'claude-opus-5-5', promptTokens: 10 }),
    ).resolves.toMatchObject({ ok: false });
  });

  it('admits everything unchecked outside a time-pack turn or with balance off', async () => {
    for (const options of [{ withEntitlement: false }, { enabled: false }]) {
      const { gate, deps } = createGate(options);

      expect(gate.checks).toBe(false);
      await expect(gate.admit({ ...helper, promptTokens: 500 })).resolves.toMatchObject({
        ok: true,
      });
      expect(deps.reserveBalance).not.toHaveBeenCalled();
    }
  });

  it('throws when the balance store fails', async () => {
    const deps = createDeps(0);
    (deps.reserveBalance as jest.Mock).mockRejectedValue(new Error('mongo down'));
    const { gate } = createGate({ deps });

    await expect(gate.admit({ ...helper, promptTokens: 1 })).rejects.toThrow('mongo down');
  });
});

describe('admitOffPackAgents', () => {
  it('lets a run of covered agents start without a credit check', async () => {
    const { gate, deps } = createGate({ balance: 0 });

    await expect(admitOffPackAgents(gate, [claude])).resolves.toBeUndefined();
    expect(deps.reserveBalance).not.toHaveBeenCalled();
  });

  it('fails the turn with the token_balance error for an unpaid off-pack handoff agent', async () => {
    const { gate, deps } = createGate({ balance: 0 });

    await expect(admitOffPackAgents(gate, [claude, helper])).rejects.toThrow(
      ViolationTypes.TOKEN_BALANCE,
    );
    expect(deps.reserveBalance).toHaveBeenCalledWith(expect.objectContaining({ amount: 120 }));
  });
});

describe('withOffPackBalance', () => {
  it('skips an unpaid off-pack call by throwing token_balance before it runs', async () => {
    const { gate } = createGate({ balance: 0 });
    const run = jest.fn().mockResolvedValue('title');

    await expect(withOffPackBalance(gate, { ...helper, promptText: 'hello' }, run)).rejects.toThrow(
      ViolationTypes.TOKEN_BALANCE,
    );
    expect(run).not.toHaveBeenCalled();
  });

  it('runs a paid call and releases its credits once it settles', async () => {
    const { gate, deps } = createGate({ balance: 1000 });
    const run = jest.fn().mockRejectedValue(new Error('provider failed'));

    await expect(withOffPackBalance(gate, { ...helper, promptText: 'hello' }, run)).rejects.toThrow(
      'provider failed',
    );
    expect(deps.releaseBalanceReservation).toHaveBeenCalledTimes(1);
  });

  it('runs a covered call without a check', async () => {
    const { gate, deps } = createGate({ balance: 0 });

    await expect(
      withOffPackBalance(gate, { ...claude, promptText: 'hello' }, async () => 'title'),
    ).resolves.toBe('title');
    expect(deps.reserveBalance).not.toHaveBeenCalled();
  });
});

describe('createOffPackMemoryAdmission', () => {
  it('prices the memory input at the memory model and refuses it without credits', async () => {
    const { gate, deps } = createGate({ balance: 0 });
    const admit = createOffPackMemoryAdmission(() => gate, {
      endpoint: 'OpenRouterPrivate',
      provider: 'OpenRouterPrivate',
      model: 'google/gemini-3.8-flash',
    });

    const admission = await admit([new HumanMessage('x'.repeat(80))]);

    expect(admission.ok).toBe(false);
    expect(deps.reserveBalance).toHaveBeenCalledWith(expect.objectContaining({ amount: 20 }));
    expect(deps.getMultiplier).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'google/gemini-3.8-flash', endpoint: 'OpenRouterPrivate' }),
    );
  });

  it('admits memory unchecked before the turn created its gate', async () => {
    const admit = createOffPackMemoryAdmission(() => undefined, helper);

    await expect(admit([new HumanMessage('hi')])).resolves.toMatchObject({ ok: true });
  });
});

describe('createSubagentBalanceHook', () => {
  const lazy = { id: 'lazy', provider: 'OpenRouter', model: 'gpt-5' };
  const parent = {
    ...claude,
    subagentAgentConfigs: [helper],
    lazySubagentConfigs: [lazy],
    subagentGraphConfigs: [
      { definition: { type: 'team' }, memberConfigs: [{ id: 'm1', provider: 'Groq', model: 'x' }] },
    ],
  };

  function createHook(balance: number) {
    const { gate, deps } = createGate({ balance });
    const subagentBalance = createSubagentBalanceHook({
      gate,
      agents: [parent],
      usageAgents: collectAgentEndpoints([parent]),
    });
    const hooks = new HookRegistry();
    hooks.register('SubagentStart', { hooks: [subagentBalance.hook] });
    const start = (agentId: string, agentType = agentId) =>
      executeHooks({
        registry: hooks,
        input: {
          hook_event_name: 'SubagentStart',
          runId: 'run-1',
          agentId,
          agentType,
          inputs: [new HumanMessage('Summarize the report.')],
        },
        sessionId: 'run-1',
        matchQuery: agentType,
      });
    return { start, deps };
  }

  it('denies an unpaid off-pack subagent with the token_balance error', async () => {
    const { start, deps } = createHook(0);

    const result = await start('helper');

    expect(result.decision).toBe('deny');
    expect(JSON.parse(result.reason ?? '')).toMatchObject({ type: ViolationTypes.TOKEN_BALANCE });
    expect(deps.getMultiplier).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-5' }));
  });

  it('allows a subagent the user can pay for', async () => {
    const { start } = createHook(1000);

    await expect(start('helper')).resolves.not.toHaveProperty('decision', 'deny');
  });

  it('starts a self-spawn of the covered primary agent without a credit check', async () => {
    const { start, deps } = createHook(0);

    await expect(start('main')).resolves.not.toHaveProperty('decision', 'deny');
    expect(deps.reserveBalance).not.toHaveBeenCalled();
  });

  it('checks every member of a graph subagent and an unknown child', async () => {
    const { start, deps } = createHook(0);

    expect((await start('main_subgraph_1', 'team')).decision).toBe('deny');
    expect(deps.getMultiplier).toHaveBeenCalledWith(expect.objectContaining({ model: 'x' }));
    expect((await start('main_sub_2', 'unknown')).decision).toBe('deny');
  });

  it('checks a lazily resolved subagent at its resolved model', async () => {
    const { gate, deps } = createGate({ balance: 0 });
    const subagentBalance = createSubagentBalanceHook({
      gate,
      agents: [claude],
      usageAgents: collectAgentEndpoints([claude]),
    });
    subagentBalance.addAgent({ id: 'late', endpoint: 'Groq', provider: 'groq', model: 'llama' });

    const result = await subagentBalance.hook(
      {
        hook_event_name: 'SubagentStart',
        runId: 'run-1',
        agentId: 'late',
        agentType: 'late',
        inputs: [],
      },
      new AbortController().signal,
    );

    expect(result).toMatchObject({ decision: 'deny' });
    expect(deps.getMultiplier).toHaveBeenCalledWith(expect.objectContaining({ model: 'llama' }));
  });

  it('denies the subagent when the balance store fails', async () => {
    const deps = createDeps(0);
    (deps.reserveBalance as jest.Mock).mockRejectedValue(new Error('mongo down'));
    const { gate } = createGate({ deps });
    const { hook } = createSubagentBalanceHook({
      gate,
      agents: [parent],
      usageAgents: collectAgentEndpoints([parent]),
    });

    const result = await hook(
      {
        hook_event_name: 'SubagentStart',
        runId: 'r',
        agentId: 'helper',
        agentType: 'helper',
        inputs: [],
      },
      new AbortController().signal,
    );

    expect(result).toEqual({ decision: 'deny', reason: expect.not.stringContaining('mongo') });
  });
});

describe('admitOffPackLabel', () => {
  const labelModel = {
    provider: 'openrouter',
    clientOptions: { model: 'gpt-5-nano' },
    endpoint: 'OpenRouter',
    sameEndpoint: false,
  };

  it('skips a label on another endpoint the user cannot pay for', async () => {
    const { gate, deps } = createGate({ balance: 0 });

    const admission = await admitOffPackLabel(
      gate,
      claude,
      'activity label',
      labelModel,
      'x'.repeat(400),
    );

    expect(admission).toEqual({ ok: false, error: { code: ViolationTypes.TOKEN_BALANCE } });
    expect(deps.reserveBalance).toHaveBeenCalledWith(expect.objectContaining({ amount: 100 }));
    expect(deps.getMultiplier).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-5-nano', endpoint: 'OpenRouter' }),
    );
  });

  it('admits a paid label and releases its credits', async () => {
    const { gate, deps } = createGate({ balance: 1000 });

    const admission = await admitOffPackLabel(gate, claude, 'activity label', labelModel, 'x');

    expect(admission.ok).toBe(true);
    await (admission.ok && admission.release());
    expect(deps.releaseBalanceReservation).toHaveBeenCalledTimes(1);
  });

  it('admits a label on the agent endpoint and an allowed model as covered', async () => {
    const { gate, deps } = createGate({ balance: 0 });

    const admission = await admitOffPackLabel(
      gate,
      claude,
      'reasoning label',
      { provider: 'anthropic', clientOptions: { model: 'claude-sonnet-5-5' }, sameEndpoint: true },
      'x',
    );

    expect(admission.ok).toBe(true);
    expect(deps.reserveBalance).not.toHaveBeenCalled();
  });

  it('checks a label on the agent endpoint with a model outside the pack', async () => {
    const { gate } = createGate({ balance: 0 });

    const admission = await admitOffPackLabel(
      gate,
      claude,
      'activity phase',
      { provider: 'anthropic', clientOptions: { model: 'claude-haiku-4' }, sameEndpoint: true },
      'x',
    );

    expect(admission.ok).toBe(false);
  });

  it('skips the label when the balance store fails', async () => {
    const deps = createDeps(1000);
    (deps.reserveBalance as jest.Mock).mockRejectedValue(new Error('db down'));
    const { gate } = createGate({ deps });

    await expect(
      admitOffPackLabel(gate, claude, 'activity label', labelModel, 'x'),
    ).resolves.toEqual({ ok: false, error: { code: 'balance_unavailable' } });
  });

  it('admits labels unchecked without a gate (resume) or outside a time-pack turn', async () => {
    const { gate, deps } = createGate({ withEntitlement: false });

    expect((await admitOffPackLabel(undefined, claude, 'label', labelModel, 'x')).ok).toBe(true);
    expect((await admitOffPackLabel(gate, claude, 'label', labelModel, 'x')).ok).toBe(true);
    expect(deps.reserveBalance).not.toHaveBeenCalled();
  });
});

describe('admitOffPack', () => {
  it('refuses a charged tool call without credits and admits it outside a time-pack turn', async () => {
    const target = {
      endpoint: 'google',
      model: 'gemini-image',
      usageEndpoint: null,
      promptText: 'x',
    };

    expect(await admitOffPack(createGate({ balance: 0 }).gate, target)).toMatchObject({
      ok: false,
      error: { code: ViolationTypes.TOKEN_BALANCE },
    });
    expect((await admitOffPack(undefined, target)).ok).toBe(true);
    expect((await admitOffPack(createGate({ enabled: false }).gate, target)).ok).toBe(true);
  });
});

describe('createOffPackSummarizationGuard', () => {
  /** A chat model whose provider call is observable; the guard runs as its client callback. */
  class ProviderModel extends SimpleChatModel {
    calls = 0;
    _llmType(): string {
      return 'provider-test';
    }

    async _call(): Promise<string> {
      this.calls += 1;
      return 'summary';
    }
  }

  const summarizer = (
    gate: ReturnType<typeof createGate>['gate'],
    provider: string,
    model: string,
  ) =>
    createOffPackSummarizationGuard({
      gate,
      agent: claude,
      agentProvider: 'anthropic',
      provider,
      model,
    });

  it('fails the summarization before the provider is invoked when the user cannot pay', async () => {
    const { gate, deps } = createGate({ balance: 0 });
    const guard = summarizer(gate, 'openrouter', 'gemini-flash');
    const model = new ProviderModel({ callbacks: [guard!] });

    const error = await model.invoke([new HumanMessage('a long history')]).catch((e) => e);

    expect(error).toBeInstanceOf(OffPackBalanceRefusalError);
    /** The summarize node rethrows this class instead of degrading to its metadata stub. */
    expect(error).toBeInstanceOf(StreamLimitExceededError);
    expect(model.calls).toBe(0);
    expect(JSON.parse(getOffPackRefusalText(error)!)).toMatchObject({
      type: ViolationTypes.TOKEN_BALANCE,
    });
    expect(deps.getMultiplier).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-flash', endpoint: 'openrouter' }),
    );
  });

  it('runs a paid summarization', async () => {
    const { gate, deps } = createGate({ balance: 1000 });
    const model = new ProviderModel({
      callbacks: [summarizer(gate, 'openrouter', 'gemini-flash')!],
    });

    await model.invoke([new HumanMessage('history')]);

    expect(model.calls).toBe(1);
    expect(deps.reserveBalance).toHaveBeenCalledTimes(1);
  });

  it('runs a self-summarization the pack covers without a check', async () => {
    const { gate, deps } = createGate({ balance: 0 });
    const model = new ProviderModel({
      callbacks: [summarizer(gate, 'anthropic', 'claude-sonnet-5-5')!],
    });

    await model.invoke([new HumanMessage('history')]);

    expect(model.calls).toBe(1);
    expect(deps.reserveBalance).not.toHaveBeenCalled();
  });

  it('fails closed with a fixed message when the balance store fails', async () => {
    const deps = createDeps(1000);
    (deps.reserveBalance as jest.Mock).mockRejectedValue(new Error('db down'));
    const { gate } = createGate({ deps });
    const model = new ProviderModel({ callbacks: [summarizer(gate, 'openrouter', 'gemini')!] });

    const error = await model.invoke([new HumanMessage('history')]).catch((e) => e);

    expect(model.calls).toBe(0);
    expect(getOffPackRefusalText(error)).toBe('The credit check for this call is unavailable.');
  });

  it('installs nothing outside a time-pack turn', () => {
    expect(
      summarizer(createGate({ withEntitlement: false }).gate, 'openrouter', 'g'),
    ).toBeUndefined();
    expect(getOffPackRefusalText(new Error('other'))).toBeUndefined();
  });
});
