import { isTimePackClaudeRequest, resolveTimePackRuntime } from 'librechat-data-provider';
import type { TimePackEntitlement, TTimePackRuntime } from 'librechat-data-provider';

/**
 * Side calls of a time-pack turn (the memory agent, summarization, the title) are not covered by
 * the pack when they run on another endpoint: they are then charged to the user's credit, or
 * refused with `token_balance` when the user has none. With `balance.timePack.sideModel` set they
 * run on the pack's own endpoint instead, so the pack meters them like the primary call.
 */

/** The pack-covered model that runs a time-pack turn's side calls. */
export type TimePackSideModel = {
  /** The pack's endpoint (the gateway), as the entitlement names it. */
  endpoint: string;
  model: string;
};

/**
 * The side model of a turn, or null when the turn is not on a time pack, no `sideModel` is
 * configured, or the pack's model allowlist excludes it (it would be charged, not metered).
 */
export function resolveTimePackSideModel({
  entitlement,
  timePack,
}: {
  entitlement?: TimePackEntitlement | null;
  timePack?: Partial<TTimePackRuntime> | null;
}): TimePackSideModel | null {
  if (entitlement == null) {
    return null;
  }
  const { sideModel } = resolveTimePackRuntime(timePack);
  if (sideModel === '') {
    return null;
  }
  const endpoint = entitlement.timePackEndpoint;
  return isTimePackClaudeRequest({ entitlement, endpoint, model: sideModel })
    ? { endpoint, model: sideModel }
    : null;
}

type MemoryAgentConfig = { id?: string | null; provider?: string; model?: string };

/**
 * The memory agent config a time-pack turn runs. Only an inline provider and model config is
 * moved; a saved memory agent (`id`) is the admin's explicit choice and stays as configured.
 */
export function applyTimePackSideModelToMemoryAgent<T extends MemoryAgentConfig>(
  agent: T,
  side: TimePackSideModel | null | undefined,
): T {
  if (side == null || agent.id != null) {
    return agent;
  }
  return { ...agent, provider: side.endpoint, model: side.model };
}

type SummarizationLike = { provider?: string; model?: string };

/**
 * The summarization config for an agent of a time-pack turn. Only an agent running on the pack's
 * endpoint is moved to the side model; agents on other endpoints keep their configured summarizer.
 */
export function applyTimePackSideModelToSummarization<T extends SummarizationLike>(
  config: T | undefined,
  agentEndpoint: string | null | undefined,
  side: TimePackSideModel | null | undefined,
): T | undefined {
  if (side == null || agentEndpoint !== side.endpoint) {
    return config;
  }
  return { ...(config ?? {}), provider: side.endpoint, model: side.model } as T;
}
