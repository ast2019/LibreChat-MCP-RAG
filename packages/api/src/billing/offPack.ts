import { logger } from '@librechat/data-schemas';
import { StreamLimitExceededError } from '@librechat/agents';
import { ViolationTypes, isTimePackClaudeRequest } from 'librechat-data-provider';
import type { BaseMessage } from '@librechat/agents/langchain/messages';
import type { TimePackEntitlement, TTimePackRuntime } from 'librechat-data-provider';
import type { BalanceConfig } from '@librechat/data-schemas';
import type { HookCallback } from '@librechat/agents';
import type { Response } from 'express';
import type {
  CheckBalanceDeps,
  BalanceReservation,
  BalanceReservations,
} from '~/middleware/checkBalance';
import type { ServerRequest } from '~/types/http';
import type { TimePackSideModel } from './timePackSideCalls';
import type { UsageEndpoint } from './usage';
import { checkBalance } from '~/middleware/checkBalance';
import { resolveTimePackSideModel } from './timePackSideCalls';
import { toUsageEndpoint } from './usage';

/**
 * A time-pack turn skips the turn's up-front balance reservation because its primary call is
 * covered by the pack. Every other model call of such a turn (memory, subagents, handoff and
 * parallel agents, titles, activity/phase/reasoning labels, summarization, the Gemini image
 * tool) is charged afterwards, so it passes the same credit check before its provider is
 * invoked. This module is that check.
 */

/** One model call a turn is about to make. */
export type OffPackTarget = {
  /** Endpoint the call runs on; prices the reservation. */
  endpoint: string | null;
  model?: string | null;
  /**
   * Endpoint the call's usage is attributed to when it is recorded, which decides whether the
   * time pack covers it (see `partitionTimePackUsage`). Defaults to `endpoint`; null when the
   * recording never meters it (memory is recorded cross-endpoint, an unlisted subagent agent).
   */
  usageEndpoint?: string | null;
  /** Prompt tokens to reserve at the model's prompt rate; counted from `promptText` if unset. */
  promptTokens?: number;
  promptText?: string;
  endpointTokenConfig?: unknown;
};

export type OffPackRefusal = { code: ViolationTypes.TOKEN_BALANCE; message: string };

export type OffPackAdmission =
  | {
      ok: true;
      /** True when the time pack covers the call, so no credit was checked or held. */
      covered: boolean;
      /** Idempotent; releases the credits held for the call. */
      release: () => Promise<void>;
    }
  | { ok: false; error: OffPackRefusal };

export type OffPackBalanceGate = {
  /** False outside a time-pack turn or with balance off: every call is admitted unchecked. */
  checks: boolean;
  /** The turn's prompt tokens, the estimate for the run's top-level agents. */
  promptTokens: number;
  /** The pack-covered model for the turn's side calls (`timePack.sideModel`), or null. */
  sideModel?: TimePackSideModel | null;
  /** Whether the time pack covers the call; such calls are metered, not charged. */
  covers: (target: Pick<OffPackTarget, 'endpoint' | 'model' | 'usageEndpoint'>) => boolean;
  /**
   * Admits a call before its provider is invoked. Unless `checks`, every call is admitted
   * unchecked: the turn's own reservation already admitted it, as for any user. Refuses with
   * `token_balance` when the user cannot cover the call; throws only for an operational
   * failure of the balance store.
   */
  admit: (target: OffPackTarget) => Promise<OffPackAdmission>;
};

export type OffPackCountTokens = (text: string) => number | Promise<number>;

const noRelease = async (): Promise<void> => undefined;
const admitted: OffPackAdmission = { ok: true, covered: false, release: noRelease };

/** Whether `error` is the insufficient-credit rejection `checkBalance` throws. */
export function isTokenBalanceError(error: unknown): error is Error {
  if (!(error instanceof Error)) {
    return false;
  }
  try {
    const parsed = JSON.parse(error.message) as { type?: unknown } | null;
    return parsed?.type === ViolationTypes.TOKEN_BALANCE;
  } catch {
    return false;
  }
}

/**
 * The balance gate of one turn. `reservations` (the turn's own) holds each admitted call's
 * credits until the turn releases them; a call that outlives the turn releases its own.
 */
export function createOffPackBalanceGate({
  req,
  res,
  user,
  entitlement,
  balanceConfig,
  timePack,
  reservations,
  deps,
  countTokens,
  promptTokens = 0,
}: {
  req: ServerRequest;
  res: Response;
  user: string;
  entitlement?: TimePackEntitlement | null;
  balanceConfig?: BalanceConfig | null;
  /** `balance.timePack`, read for `sideModel`. */
  timePack?: Partial<TTimePackRuntime> | null;
  reservations?: BalanceReservations;
  deps: Omit<CheckBalanceDeps, 'balanceConfig'>;
  countTokens: OffPackCountTokens;
  promptTokens?: number;
}): OffPackBalanceGate {
  const checks = entitlement != null && balanceConfig?.enabled === true;
  const covers: OffPackBalanceGate['covers'] = ({ endpoint, model, usageEndpoint }) =>
    entitlement != null &&
    isTimePackClaudeRequest({
      entitlement,
      endpoint: usageEndpoint === undefined ? endpoint : usageEndpoint,
      model,
    });

  const admit: OffPackBalanceGate['admit'] = async (target) => {
    if (!checks) {
      return admitted;
    }
    if (covers(target)) {
      return { ok: true, covered: true, release: noRelease };
    }
    const tokens = target.promptTokens ?? (await countTokens(target.promptText ?? ''));
    const admission = checkBalance(
      {
        req,
        res,
        txData: {
          user,
          tokenType: 'prompt',
          /** At least one token, so an empty balance never admits a call. */
          amount: Math.max(1, Math.ceil(tokens)),
          endpoint: target.endpoint ?? undefined,
          model: target.model ?? undefined,
          endpointTokenConfig: target.endpointTokenConfig,
        },
      },
      { ...deps, balanceConfig: balanceConfig ?? undefined },
    );
    let reservation: BalanceReservation;
    try {
      reservation = await (reservations?.track(admission) ?? admission);
    } catch (error) {
      if (isTokenBalanceError(error)) {
        return { ok: false, error: { code: ViolationTypes.TOKEN_BALANCE, message: error.message } };
      }
      throw error;
    }
    return { ok: true, covered: false, release: () => reservation.release() };
  };

  const sideModel = resolveTimePackSideModel({ entitlement, timePack });
  return { checks, promptTokens, sideModel, covers, admit };
}

type BalanceAgent = {
  id?: string | null;
  endpoint?: string | null;
  provider?: string | null;
  model?: string | null;
  model_parameters?: { model?: unknown } | null;
  endpointTokenConfig?: unknown;
};

function agentModel(agent: BalanceAgent): string | null {
  if (agent.model) {
    return agent.model;
  }
  const model = agent.model_parameters?.model;
  return typeof model === 'string' ? model : null;
}

function agentTarget(agent: BalanceAgent): OffPackTarget {
  return {
    endpoint: toUsageEndpoint(agent).endpoint,
    model: agentModel(agent),
    endpointTokenConfig: agent.endpointTokenConfig,
  };
}

/**
 * Admits the top-level agents of a time-pack run (the primary plus handoff and parallel agents)
 * before the run starts. They share one graph and cannot be refused one by one, so an off-pack
 * agent the user cannot pay for fails the turn with the `token_balance` error, as the turn's
 * own reservation fails for a user without a time pack.
 */
export async function admitOffPackAgents(
  gate: OffPackBalanceGate | null | undefined,
  agents: Iterable<BalanceAgent | null | undefined>,
): Promise<void> {
  if (gate?.checks !== true) {
    return;
  }
  const seen = new Set<string>();
  for (const agent of agents) {
    if (agent == null || (agent.id != null && seen.has(agent.id))) {
      continue;
    }
    if (agent.id != null) {
      seen.add(agent.id);
    }
    const admission = await gate.admit({ ...agentTarget(agent), promptTokens: gate.promptTokens });
    if (!admission.ok) {
      throw new Error(admission.error.message);
    }
  }
}

/**
 * Runs one off-pack call that may outlive the turn (a title): admits it, throws the
 * `token_balance` error when the user cannot pay for it, and releases its credits once the
 * call settles.
 */
export async function withOffPackBalance<T>(
  gate: OffPackBalanceGate | null | undefined,
  target: OffPackTarget,
  run: () => Promise<T>,
): Promise<T> {
  if (gate?.checks !== true) {
    return run();
  }
  const admission = await gate.admit(target);
  if (!admission.ok) {
    throw new Error(admission.error.message);
  }
  try {
    return await run();
  } finally {
    await admission.release();
  }
}

/**
 * Admits one call that has no turn-level owner (a tool's own model call). Outside a checking
 * gate it is admitted unchecked. Refuses with `token_balance`; throws only when the balance
 * store fails.
 */
export async function admitOffPack(
  gate: OffPackBalanceGate | null | undefined,
  target: OffPackTarget,
): Promise<OffPackAdmission> {
  if (gate?.checks !== true) {
    return admitted;
  }
  return gate.admit(target);
}

/** The model a label call resolved to (the shape of `ActivityLabelLLM`). */
export type OffPackLabelModel = {
  provider?: string | null;
  clientOptions?: { model?: unknown } | null;
  /** Endpoint the label runs on; the agent's when unset. */
  endpoint?: string | null;
  endpointTokenConfig?: unknown;
  /** False when the label runs on another endpoint than the agent (`activityEndpoint`). */
  sameEndpoint?: boolean;
};

export type OffPackLabelAdmission =
  | { ok: true; release: () => Promise<void> }
  | { ok: false; error: { code: string } };

/** Admits one label call given its resolved model and the prompt it is about to send. */
export type OffPackLabelAdmit = (
  llm: OffPackLabelModel,
  promptText: string,
) => Promise<OffPackLabelAdmission>;

const labelAdmitted: OffPackLabelAdmission = { ok: true, release: noRelease };

/**
 * The label target as `recordActivityLabelUsage` records it: usage that names no agent, on the
 * agent's endpoint unless the label runs elsewhere or on another provider, where it is charged.
 */
function labelTarget(agent: BalanceAgent, llm: OffPackLabelModel): OffPackTarget {
  const agentUsage = toUsageEndpoint(agent);
  const sameEndpoint = llm.sameEndpoint !== false;
  const sameProvider =
    llm.provider == null || agent.provider == null || llm.provider === agent.provider;
  const model = llm.clientOptions?.model;
  return {
    endpoint: llm.endpoint ?? agentUsage.endpoint,
    model: typeof model === 'string' ? model : agentModel(agent),
    usageEndpoint: sameEndpoint && sameProvider ? agentUsage.endpoint : null,
    endpointTokenConfig:
      llm.endpointTokenConfig ?? (sameEndpoint ? agent.endpointTokenConfig : undefined),
  };
}

/**
 * Admits an activity, phase or reasoning label before its model is invoked. Labels are optional
 * side work: without the credits, or when the balance store fails, the label is skipped (logged)
 * and the turn continues with the deterministic placeholder. The caller releases the credits once
 * the call settles.
 */
export async function admitOffPackLabel(
  gate: OffPackBalanceGate | null | undefined,
  agent: BalanceAgent,
  kind: string,
  llm: OffPackLabelModel,
  promptText: string,
): Promise<OffPackLabelAdmission> {
  if (gate?.checks !== true) {
    return labelAdmitted;
  }
  const target = labelTarget(agent, llm);
  try {
    const admission = await gate.admit({ ...target, promptText });
    if (admission.ok) {
      return { ok: true, release: admission.release };
    }
    logger.info(`[billing/offPack] Skipped the ${kind}: its model was not admitted`, {
      model: target.model,
      code: admission.error.code,
    });
    return { ok: false, error: { code: admission.error.code } };
  } catch (error) {
    logger.error(`[billing/offPack] The ${kind} balance check failed; skipping it`, {
      error: error instanceof Error ? error.name : typeof error,
    });
    return { ok: false, error: { code: 'balance_unavailable' } };
  }
}

export type OffPackRefusalCode = ViolationTypes.TOKEN_BALANCE | 'balance_unavailable';

const BALANCE_UNAVAILABLE_MESSAGE = 'The credit check for this call is unavailable.';

/**
 * Fails a run whose required off-pack call (summarization) was refused. It extends the SDK's
 * stream-limit error because that is the class the summarize node rethrows instead of degrading
 * to its metadata stub or trying fallback providers (`@librechat/agents`
 * src/summarization/node.ts, `executeSummarizationWithFallback`), as `FatalModelBoundPolicyError`
 * does for the content policy.
 */
export class OffPackBalanceRefusalError extends StreamLimitExceededError {
  public readonly code: OffPackRefusalCode;

  constructor(code: OffPackRefusalCode, message: string) {
    super({ kind: 'delta_events', limit: 0, observed: 0 });
    this.name = 'OffPackBalanceRefusalError';
    this.message = message;
    this.code = code;
    Object.setPrototypeOf(this, OffPackBalanceRefusalError.prototype);
  }
}

/**
 * The error text a refused run shows the user: the same `token_balance` payload a normal
 * balance refusal sends, or a fixed message when the balance store failed. Undefined for any
 * other error.
 */
export function getOffPackRefusalText(error: unknown): string | undefined {
  if (!(error instanceof OffPackBalanceRefusalError)) {
    return undefined;
  }
  return error.code === ViolationTypes.TOKEN_BALANCE ? error.message : BALANCE_UNAVAILABLE_MESSAGE;
}

/**
 * A LangChain callback that admits a model call before the provider is invoked: LangChain awaits
 * `handleChatModelStart` (`awaitHandlers`) before the request is sent, and rethrows its error
 * (`raiseError`), so a refusal means no provider call.
 */
export type OffPackModelGuard = {
  readonly name: 'librechat-off-pack-balance';
  readonly raiseError: true;
  readonly awaitHandlers: true;
  readonly handleChatModelStart: (
    llm: unknown,
    messageBatches: readonly (readonly BaseMessage[])[],
  ) => Promise<void>;
  readonly handleLLMStart: (llm: unknown, prompts: readonly string[]) => Promise<void>;
};

/**
 * The guard installed on an agent's summarization client in a time-pack turn. Summarization
 * usage is recorded under the agent's id, so it is covered when it runs on the agent's provider
 * with a model the pack allows. Any other summarizer reserves its input at its own rate; when
 * it cannot, the run fails with `token_balance`, as a normal turn the user cannot pay for does.
 * Undefined when the gate does not check.
 */
export function createOffPackSummarizationGuard({
  gate,
  agent,
  agentProvider,
  provider,
  model,
}: {
  gate: OffPackBalanceGate | null | undefined;
  agent: BalanceAgent;
  /** The provider the agent's own calls run on, as the run resolved it. */
  agentProvider?: string | null;
  /** The summarizer's provider and model. */
  provider?: string | null;
  model?: string | null;
}): OffPackModelGuard | undefined {
  if (gate?.checks !== true) {
    return undefined;
  }
  const agentUsage = toUsageEndpoint(agent);
  const sameProvider = provider == null || agentProvider == null || provider === agentProvider;
  const target: OffPackTarget = {
    endpoint: sameProvider ? agentUsage.endpoint : provider,
    model: model ?? agentModel(agent),
    usageEndpoint: sameProvider ? agentUsage.endpoint : null,
    endpointTokenConfig: sameProvider ? agent.endpointTokenConfig : undefined,
  };
  const admit = async (promptText: string): Promise<void> => {
    let admission: OffPackAdmission;
    try {
      admission = await gate.admit({ ...target, promptText });
    } catch (error) {
      logger.error('[billing/offPack] Summarization balance check failed; failing the run', {
        error: error instanceof Error ? error.name : typeof error,
      });
      throw new OffPackBalanceRefusalError('balance_unavailable', BALANCE_UNAVAILABLE_MESSAGE);
    }
    if (!admission.ok) {
      logger.info('[billing/offPack] Summarization refused: its model was not admitted', {
        model: target.model,
      });
      throw new OffPackBalanceRefusalError(ViolationTypes.TOKEN_BALANCE, admission.error.message);
    }
  };
  return Object.freeze({
    name: 'librechat-off-pack-balance',
    raiseError: true,
    awaitHandlers: true,
    handleChatModelStart: (_llm: unknown, messageBatches: readonly (readonly BaseMessage[])[]) =>
      admit(messagesText(messageBatches.flat())),
    handleLLMStart: (_llm: unknown, prompts: readonly string[]) => admit(prompts.join('\n')),
  });
}

function messagesText(messages: readonly BaseMessage[]): string {
  return messages
    .map((message) =>
      typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
    )
    .join('\n');
}

/**
 * The memory agent's admission: its input priced at the memory model's rate. Memory usage is
 * recorded cross-endpoint and so charged, unless it runs on the pack's own endpoint as the
 * side model, where the pack meters it. The gate is
 * read when memory runs, since memory is prepared before the turn creates it.
 */
export function createOffPackMemoryAdmission(
  getGate: () => OffPackBalanceGate | null | undefined,
  agent: BalanceAgent,
  /** Set when the memory model runs on the pack's endpoint (`timePack.sideModel`): metered. */
  side?: TimePackSideModel | null,
): (messages: readonly BaseMessage[]) => Promise<OffPackAdmission> {
  return async (messages) => {
    const gate = getGate();
    if (gate?.checks !== true) {
      return admitted;
    }
    return gate.admit({
      ...agentTarget(agent),
      usageEndpoint: side != null ? side.endpoint : null,
      promptText: messagesText(messages),
    });
  };
}

type SubagentNode = BalanceAgent & {
  subagentAgentConfigs?: readonly (SubagentNode | null | undefined)[] | null;
  lazySubagentConfigs?: readonly (SubagentNode | null | undefined)[] | null;
  subagentGraphConfigs?: ReadonlyArray<{
    definition?: { type?: string | null } | null;
    memberConfigs: readonly SubagentNode[];
  }> | null;
};

export type SubagentBalanceHook = {
  hook: HookCallback<'SubagentStart'>;
  /** Registers an agent resolved after the run started (a lazy subagent). */
  addAgent: (agent: SubagentNode) => void;
};

/**
 * A `SubagentStart` hook that admits each subagent child before its first model call. A child
 * is covered only when its usage would be metered: it is one of `usageAgents` (the agents the
 * turn's usage recording knows) on the time pack. Any other child is checked like a normal
 * call; without the credits the subagent is denied with the `token_balance` error as its
 * reason and the parent turn continues. A failure of the balance store denies it too, since
 * the SDK treats a failed hook as an allow.
 */
export function createSubagentBalanceHook({
  gate,
  agents,
  usageAgents,
}: {
  gate: OffPackBalanceGate;
  agents: Iterable<SubagentNode | null | undefined>;
  usageAgents: ReadonlyMap<string, UsageEndpoint>;
}): SubagentBalanceHook {
  const byId = new Map<string, SubagentNode>();
  const graphsByType = new Map<string, readonly SubagentNode[]>();

  const addAgent = (root: SubagentNode) => {
    const pending: (SubagentNode | null | undefined)[] = [root];
    for (let index = 0; index < pending.length; index++) {
      const agent = pending[index];
      if (agent?.id == null || byId.has(agent.id)) {
        continue;
      }
      byId.set(agent.id, agent);
      pending.push(...(agent.subagentAgentConfigs ?? []), ...(agent.lazySubagentConfigs ?? []));
      for (const graph of agent.subagentGraphConfigs ?? []) {
        const type = graph.definition?.type;
        if (type != null && !graphsByType.has(type)) {
          graphsByType.set(type, graph.memberConfigs);
        }
        pending.push(...graph.memberConfigs);
      }
    }
  };
  for (const agent of agents) {
    if (agent != null) {
      addAgent(agent);
    }
  }

  const toTarget = (agent: SubagentNode | undefined): OffPackTarget => {
    const metered = agent?.id != null ? usageAgents.get(agent.id) : undefined;
    return {
      ...(agent != null ? agentTarget(agent) : { endpoint: null, model: null }),
      usageEndpoint: metered?.endpoint ?? null,
    };
  };

  const hook: HookCallback<'SubagentStart'> = async (input) => {
    if (!gate.checks) {
      return {};
    }
    const agent = byId.get(input.agentId);
    const members = agent != null ? [agent] : [...(graphsByType.get(input.agentType) ?? [])];
    const targets = (members.length > 0 ? members : [undefined]).map(toTarget);
    if (targets.every((target) => gate.covers(target))) {
      return {};
    }
    const promptText = messagesText(input.inputs ?? []);
    try {
      for (const target of targets) {
        const admission = await gate.admit({ ...target, promptText });
        if (!admission.ok) {
          return { decision: 'deny', reason: admission.error.message };
        }
      }
      return {};
    } catch (error) {
      logger.error('[billing/offPack] Subagent balance check failed; denying the subagent', {
        agentType: input.agentType,
        error: error instanceof Error ? error.name : typeof error,
      });
      return { decision: 'deny', reason: 'The credit check for this subagent is unavailable.' };
    }
  };

  return { hook, addAgent };
}
