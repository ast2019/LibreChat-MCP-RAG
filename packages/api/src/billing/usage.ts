import { isTimePackClaudeRequest, TIME_METER_CONTEXT } from 'librechat-data-provider';
import type { TimePackEntitlement } from 'librechat-data-provider';
import type { RecordUsageDeps, RecordUsageParams, RecordUsageResult } from '~/agents/usage';
import type { UsageMetadata } from '~/stream/interfaces/IJobStore';
import { computeUsageCostUSD, recordCollectedUsage } from '~/agents/usage';

/** Where an agent's calls run: the configured endpoint and the SDK provider behind it. */
export type UsageEndpoint = { endpoint: string | null; provider?: string | null };

export type TimePackUsageScope = {
  /** The entitlement the turn ran under; null or absent charges everything. */
  entitlement?: TimePackEntitlement | null;
  /** Where usage that names no agent ran (the recording's own endpoint); null when unknown. */
  defaultEndpoint?: UsageEndpoint | null;
  /** Each agent of the run, by agent id. Usage of an unlisted agent is charged. */
  agentEndpoints?: ReadonlyMap<string, UsageEndpoint>;
};

export type TimePackUsagePartition = {
  metered: UsageMetadata[];
  charged: UsageMetadata[];
};

function isMessageUsage(usage: UsageMetadata): boolean {
  return (
    usage.usage_type !== 'summarization' &&
    usage.usage_type !== 'subagent' &&
    usage.usage_type !== 'sequential'
  );
}

/**
 * Splits a turn's usage into what the time pack covers (its endpoint and an allowed model) and
 * what is charged as usual: other models of the same run (subagents, summarization, memory,
 * titles on another endpoint) keep their normal price.
 */
export function partitionTimePackUsage(
  collectedUsage: readonly (UsageMetadata | null | undefined)[],
  { entitlement, defaultEndpoint = null, agentEndpoints }: TimePackUsageScope,
  model?: string,
): TimePackUsagePartition {
  const metered: UsageMetadata[] = [];
  const charged: UsageMetadata[] = [];
  for (const usage of collectedUsage) {
    if (usage == null) {
      continue;
    }
    const target =
      usage.agentId != null ? (agentEndpoints?.get(usage.agentId) ?? null) : defaultEndpoint;
    /** A row reporting another provider (e.g. summarization on a different model) did not run
     * on this endpoint even when it names no agent. */
    const sameProvider =
      usage.provider == null || target?.provider == null || usage.provider === target.provider;
    const covered =
      entitlement != null &&
      sameProvider &&
      isTimePackClaudeRequest({
        entitlement,
        endpoint: target?.endpoint ?? null,
        model: usage.model ?? model,
      });
    (covered ? metered : charged).push(usage);
  }
  return { metered, charged };
}

export type TimePackUsageRecording = {
  scope: TimePackUsageScope;
  /** Adds the metered usage's credit value to the user's fairness window. */
  meter: (credits: number) => Promise<void>;
};

/**
 * {@link recordCollectedUsage} for a turn that may run on a time pack. Covered usage is written
 * to the ledger under `time_meter` without touching the balance and its credit value is metered;
 * the rest is recorded with the caller's balance settings. Without covered usage this is exactly
 * `recordCollectedUsage`.
 */
export async function recordTimePackUsage(
  deps: RecordUsageDeps,
  params: RecordUsageParams,
  { scope, meter }: TimePackUsageRecording,
): Promise<RecordUsageResult | undefined> {
  const { metered, charged } = partitionTimePackUsage(
    params.collectedUsage ?? [],
    scope,
    params.model,
  );
  if (metered.length === 0) {
    return recordCollectedUsage(deps, params);
  }
  const chargedResult =
    charged.length > 0
      ? await recordCollectedUsage(deps, { ...params, collectedUsage: charged })
      : undefined;
  const meteredResult = await recordCollectedUsage(deps, {
    ...params,
    collectedUsage: metered,
    context: TIME_METER_CONTEXT,
    balance: { enabled: false },
    transactions: { enabled: true },
  });

  if (deps.pricing != null) {
    let credits = 0;
    for (const usage of metered) {
      const tokenConfig = params.resolveEndpointTokenConfig
        ? params.resolveEndpointTokenConfig(usage)
        : params.endpointTokenConfig;
      credits +=
        computeUsageCostUSD(
          { ...usage, model: usage.model ?? params.model },
          deps.pricing,
          tokenConfig,
        ) * 1_000_000;
    }
    if (credits > 0) {
      await meter(credits);
    }
  }

  const firstMessage = params.collectedUsage.find(
    (usage): usage is UsageMetadata => usage != null && isMessageUsage(usage),
  );
  const inputSource =
    firstMessage != null && metered.includes(firstMessage) ? meteredResult : chargedResult;
  return {
    input_tokens: inputSource?.input_tokens ?? 0,
    output_tokens: (chargedResult?.output_tokens ?? 0) + (meteredResult?.output_tokens ?? 0),
  };
}

type EndpointAgent = { id?: string | null; endpoint?: string | null; provider?: string | null };

/**
 * Endpoint of each agent of a run by id, for {@link partitionTimePackUsage}. Initialization
 * stores the configured endpoint on `endpoint` and may replace `provider` with the SDK provider.
 */
export function collectAgentEndpoints(
  agents: Iterable<EndpointAgent | null | undefined>,
): Map<string, UsageEndpoint> {
  const endpoints = new Map<string, UsageEndpoint>();
  for (const agent of agents) {
    if (agent?.id != null && !endpoints.has(agent.id)) {
      endpoints.set(agent.id, toUsageEndpoint(agent));
    }
  }
  return endpoints;
}

/** An agent's {@link UsageEndpoint}; null when it has no endpoint. */
export function toUsageEndpoint(agent: EndpointAgent | null | undefined): UsageEndpoint {
  return {
    endpoint: agent?.endpoint ?? agent?.provider ?? null,
    provider: agent?.provider ?? null,
  };
}
