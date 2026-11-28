import { ErrorTypes } from 'librechat-data-provider';
import { HumanMessage } from '@librechat/agents/langchain/messages';
import type { TimePackEntitlement } from 'librechat-data-provider';
import type { Response } from 'express';
import type { CheckBalanceDeps } from '~/middleware/checkBalance';
import type { TimePackRequestAdmission } from './admitTimePack';
import type { ServerRequest } from '~/types/http';
import {
  applyTimePackSideModelToSummarization,
  applyTimePackSideModelToMemoryAgent,
  resolveTimePackSideModel,
} from './timePackSideCalls';
import { createOffPackBalanceGate, createOffPackMemoryAdmission } from './offPack';
import { isEmptyCompletion, runWithEmptyRetry } from './emptyRetry';
import { createBalanceReservations } from '~/middleware/checkBalance';
import { resolveTimePackRecovery } from './route';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { debug: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

const entitlement: TimePackEntitlement = {
  timePackId: 'claude-time',
  timePackEndpoint: 'ClaudeTime',
  timePackExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
};

const SIDE = 'claude-haiku-5-5';

describe('resolveTimePackSideModel', () => {
  it('is null without an entitlement or without a configured side model', () => {
    expect(
      resolveTimePackSideModel({ entitlement: null, timePack: { sideModel: SIDE } }),
    ).toBeNull();
    expect(resolveTimePackSideModel({ entitlement, timePack: {} })).toBeNull();
    expect(resolveTimePackSideModel({ entitlement, timePack: undefined })).toBeNull();
  });

  it('names the pack endpoint and the configured model', () => {
    expect(resolveTimePackSideModel({ entitlement, timePack: { sideModel: SIDE } })).toEqual({
      endpoint: 'ClaudeTime',
      model: SIDE,
    });
  });

  it('is null when the pack allowlist excludes the side model (it would be charged)', () => {
    const narrow = { ...entitlement, models: ['claude-sonnet-5-5'] };
    expect(
      resolveTimePackSideModel({ entitlement: narrow, timePack: { sideModel: SIDE } }),
    ).toBeNull();
  });
});

describe('side model routing', () => {
  const side = { endpoint: 'ClaudeTime', model: SIDE };

  it('moves an inline memory agent to the pack endpoint and keeps a saved agent', () => {
    const inline = { provider: 'OpenRouterPrivate', model: 'google/gemini-3.8-flash' };
    expect(applyTimePackSideModelToMemoryAgent(inline, side)).toEqual({
      provider: 'ClaudeTime',
      model: SIDE,
    });
    expect(applyTimePackSideModelToMemoryAgent(inline, null)).toBe(inline);
    const saved = { id: 'agent_1' };
    expect(applyTimePackSideModelToMemoryAgent(saved, side)).toBe(saved);
  });

  it('moves summarization only for agents on the pack endpoint', () => {
    const config = { provider: 'OpenRouter', model: 'x', enabled: true };
    expect(applyTimePackSideModelToSummarization(config, 'ClaudeTime', side)).toEqual({
      enabled: true,
      provider: 'ClaudeTime',
      model: SIDE,
    });
    expect(applyTimePackSideModelToSummarization(config, 'OpenRouter', side)).toBe(config);
    expect(applyTimePackSideModelToSummarization(config, 'ClaudeTime', null)).toBe(config);
  });

  it('meters the memory call on the pack instead of reserving credit', async () => {
    const deps: Omit<CheckBalanceDeps, 'balanceConfig'> = {
      getMultiplier: jest.fn().mockReturnValue(1),
      reserveBalance: jest.fn().mockResolvedValue({ reserved: false, balance: 0 }),
      renewBalanceReservation: jest.fn(),
      releaseBalanceReservation: jest.fn(),
      logViolation: jest.fn(),
    };
    const gate = createOffPackBalanceGate({
      req: { user: { id: 'u' } } as ServerRequest,
      res: {} as Response,
      user: 'u',
      entitlement,
      balanceConfig: { enabled: true },
      timePack: { sideModel: SIDE },
      reservations: createBalanceReservations(),
      deps,
      countTokens: () => 10,
    });
    expect(gate.sideModel).toEqual({ endpoint: 'ClaudeTime', model: SIDE });
    const agent = { endpoint: 'ClaudeTime', provider: 'anthropic', model: SIDE };

    const onPack = await createOffPackMemoryAdmission(
      () => gate,
      agent,
      gate.sideModel,
    )([new HumanMessage('hello')]);
    const offPack = await createOffPackMemoryAdmission(
      () => gate,
      agent,
    )([new HumanMessage('hello')]);

    expect(onPack).toMatchObject({ ok: true, covered: true });
    expect(offPack.ok).toBe(false);
    expect(deps.reserveBalance).toHaveBeenCalledTimes(1);
  });
});

describe('isEmptyCompletion', () => {
  it('counts missing, blank and thinking-only replies as empty', () => {
    expect(isEmptyCompletion([], 1)).toBe(true);
    expect(isEmptyCompletion([{ type: 'think', text: 'hmm' }], 1)).toBe(true);
    expect(isEmptyCompletion([{ type: 'text', text: '  \n' }], 1)).toBe(true);
    expect(isEmptyCompletion([{ type: 'text', text: { value: ' ' } }], 1)).toBe(true);
  });

  it('keeps replies with text, a tool call or any other part', () => {
    expect(isEmptyCompletion([{ type: 'text', text: 'Hi' }], 1)).toBe(false);
    expect(isEmptyCompletion([{ type: 'text', text: { value: 'Hi' } }], 1)).toBe(false);
    expect(isEmptyCompletion([{ type: 'tool_call' }], 1)).toBe(false);
    expect(isEmptyCompletion([{ type: 'error', text: 'x' }], 1)).toBe(false);
  });

  it('honors the minimum visible characters', () => {
    expect(isEmptyCompletion([{ type: 'text', text: '.' }], 3)).toBe(true);
    expect(isEmptyCompletion([{ type: 'text', text: 'abc' }], 3)).toBe(false);
  });
});

describe('runWithEmptyRetry', () => {
  const admitted: TimePackRequestAdmission = { kind: 'admitted' };

  function setup({
    replies,
    timePack = { emptyRetry: true },
    entitled = true,
    canRetry = true,
    admission = admitted,
  }: {
    replies: string[];
    timePack?: Record<string, unknown>;
    entitled?: boolean;
    canRetry?: boolean;
    admission?: TimePackRequestAdmission;
  }) {
    const req: {
      _timePackEntitlement: TimePackEntitlement | null;
      _scheduleConcurrencyExempt?: boolean;
    } = {
      _timePackEntitlement: entitled ? entitlement : null,
    };
    const parts: { type: string; text: string }[] = [];
    const usage: number[] = [];
    const events: string[] = [];
    let call = 0;
    const attempt = jest.fn(async (isRetry: boolean) => {
      events.push(isRetry ? 'attempt:retry' : 'attempt:first');
      const text = replies[call++] ?? '';
      parts.push({ type: 'text', text });
      usage.push(5);
    });
    const releaseSeat = jest.fn(async () => {
      events.push('release');
    });
    const reacquireSeat = jest.fn(async () => {
      events.push('reacquire');
      if (admission.kind === 'admitted') {
        req._timePackEntitlement = entitlement;
      } else {
        req._timePackEntitlement = null;
      }
      return admission;
    });
    const run = () =>
      runWithEmptyRetry({
        req,
        timePack,
        attempt,
        getContentParts: () => parts,
        canRetry: () => canRetry,
        resetAttempt: () => {
          events.push('reset');
          parts.length = 0;
          usage.length = 0;
        },
        releaseSeat,
        reacquireSeat,
      });
    return { run, req, parts, usage, events, attempt, releaseSeat, reacquireSeat };
  }

  it('retries once after releasing the seat and meters only the second attempt', async () => {
    const t = setup({ replies: ['', 'Hello'] });

    await expect(t.run()).resolves.toEqual({ retried: true });

    expect(t.events).toEqual(['attempt:first', 'release', 'reacquire', 'reset', 'attempt:retry']);
    expect(t.parts).toEqual([{ type: 'text', text: 'Hello' }]);
    expect(t.usage).toEqual([5]);
  });

  it('retries only once when the second attempt is empty too', async () => {
    const t = setup({ replies: ['', ' '] });

    await expect(t.run()).resolves.toEqual({ retried: true });

    expect(t.attempt).toHaveBeenCalledTimes(2);
    expect(t.releaseSeat).toHaveBeenCalledTimes(1);
    expect(t.usage).toEqual([5]);
  });

  it('does not retry a good reply', async () => {
    const t = setup({ replies: ['Hello'] });

    await expect(t.run()).resolves.toEqual({ retried: false });

    expect(t.attempt).toHaveBeenCalledTimes(1);
    expect(t.releaseSeat).not.toHaveBeenCalled();
  });

  it('does nothing extra by default, off a time pack, or when the turn cannot be retried', async () => {
    for (const t of [
      setup({ replies: [''], timePack: {} }),
      setup({ replies: [''], entitled: false }),
      setup({ replies: [''], canRetry: false }),
    ]) {
      await expect(t.run()).resolves.toEqual({ retried: false });
      expect(t.attempt).toHaveBeenCalledTimes(1);
      expect(t.releaseSeat).not.toHaveBeenCalled();
    }
  });

  it('keeps the first reply and the entitlement when no seat is available again', async () => {
    const t = setup({
      replies: [''],
      admission: {
        kind: 'rejected',
        admission: {
          ok: false,
          reason: 'busy',
          pendingSeats: 4,
          limit: 4,
          score: 1,
          logViolation: true,
        },
      } as unknown as TimePackRequestAdmission,
    });

    await expect(t.run()).resolves.toEqual({ retried: false, skipped: 'seat_unavailable' });

    expect(t.attempt).toHaveBeenCalledTimes(1);
    expect(t.req._timePackEntitlement).toBe(entitlement);
    expect(t.req._scheduleConcurrencyExempt).toBe(true);
    expect(t.usage).toEqual([5]);
  });

  it('does not retry a failed attempt', async () => {
    const t = setup({ replies: [''] });
    t.attempt.mockRejectedValueOnce(new Error('boom'));

    await expect(t.run()).rejects.toThrow('boom');

    expect(t.releaseSeat).not.toHaveBeenCalled();
  });
});

describe('resolveTimePackRecovery', () => {
  const user = {
    id: 'u1',
    timePackId: 'claude-time',
    timePackEndpoint: 'ClaudeTime',
    timePackExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
  };

  it('attaches the live entitlement on the pack endpoint', () => {
    const result = resolveTimePackRecovery({ user, endpoint: 'ClaudeTime' });
    expect(result).toMatchObject({ ok: true, entitlement: { timePackId: 'claude-time' } });
  });

  it('reports plan_mismatch, not a missing plan, for a holder on another endpoint', () => {
    const result = resolveTimePackRecovery({ user, endpoint: 'OtherGateway' });
    expect(result).toEqual({
      ok: false,
      error: {
        type: ErrorTypes.TIME_PACK_REQUIRED,
        code: ErrorTypes.TIME_PACK_REQUIRED,
        reason: 'plan_mismatch',
      },
    });
  });

  it('reports no_entitlement for a user without an active plan', () => {
    const expired = { ...user, timePackExpiresAt: new Date('2000-01-01T00:00:00.000Z') };
    const result = resolveTimePackRecovery({ user: expired, endpoint: 'ClaudeTime' });
    expect(result).toMatchObject({ ok: false, error: { reason: 'no_entitlement' } });
  });
});
