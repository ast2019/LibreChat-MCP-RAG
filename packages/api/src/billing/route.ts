import {
  ErrorTypes,
  isTimePackEndpoint,
  isTimePackClaudeRequest,
  getActiveTimePackEntitlement,
} from 'librechat-data-provider';
import type { TBalancePack, TimePackEntitlement } from 'librechat-data-provider';

/** The pack fields routing reads; merged config overrides may leave any of them out. */
export type TimePackRoutePack = Partial<Pick<TBalancePack, 'id' | 'kind' | 'endpoint' | 'models'>>;

/**
 * Pure time-pack routing: which requests and agents belong to the time pack. Kept free of the
 * seat pool so agent initialization can check it without loading the cache clients.
 */

export type TimePackAdmitUser = {
  id?: string;
  timePackId?: string | null;
  timePackLabel?: string | null;
  timePackExpiresAt?: Date | string | null;
  timePackGrantedAt?: Date | string | null;
  timePackEndpoint?: string | null;
};

/**
 * How a request's endpoint relates to the time packs:
 * - `none`: not a time-pack endpoint; the ordinary concurrency and credit rules apply.
 * - `seat`: the user's active entitlement covers this endpoint and model.
 * - `denied`: a time-pack endpoint without a matching entitlement (code `time_pack_required`).
 */
export type TimePackRoute =
  | { kind: 'none' }
  | { kind: 'seat'; entitlement: TimePackEntitlement }
  | { kind: 'denied'; code: ErrorTypes.TIME_PACK_REQUIRED };

/** The entitlement with its pack's model allowlist, or null when the user has none active. */
export function getTimePackEntitlement(
  user: TimePackAdmitUser | null | undefined,
  packs: readonly TimePackRoutePack[] | null | undefined,
  now: Date = new Date(),
): TimePackEntitlement | null {
  const entitlement = getActiveTimePackEntitlement(user ?? undefined, now);
  if (entitlement == null) {
    return null;
  }
  const pack = packs?.find((entry) => entry.id === entitlement.timePackId);
  return pack?.models != null && pack.models.length > 0
    ? { ...entitlement, models: [...pack.models] }
    : entitlement;
}

/** Classifies a request (or one agent of it) by its real endpoint and model. */
export function resolveTimePackRoute({
  user,
  endpoint,
  model,
  packs,
  now,
}: {
  user?: TimePackAdmitUser | null;
  endpoint?: string | null;
  model?: string | null;
  packs?: readonly TimePackRoutePack[] | null;
  now?: Date;
}): TimePackRoute {
  if (!isTimePackEndpoint(packs, endpoint)) {
    return { kind: 'none' };
  }
  const entitlement = getTimePackEntitlement(user, packs, now);
  if (isTimePackClaudeRequest({ entitlement, endpoint, model })) {
    return { kind: 'seat', entitlement: entitlement as TimePackEntitlement };
  }
  return { kind: 'denied', code: ErrorTypes.TIME_PACK_REQUIRED };
}

type TargetAgent = { provider?: string | null; model?: string | null } | null | undefined;

export type TimePackTargetInput = {
  /** `endpointOption` from the agents route; `agent` is the agent being loaded (a promise). */
  endpointOption?: {
    endpoint?: string | null;
    endpointType?: string | null;
    agent?: TargetAgent | Promise<TargetAgent>;
    modelOptions?: { model?: string | null } | null;
    model_parameters?: { model?: string | null } | null;
  } | null;
  body?: { endpoint?: string | null; model?: string | null } | null;
};

/**
 * The endpoint and model a request really runs on: a saved agent's provider and model rather
 * than the `agents` route name, falling back to the route's endpoint for ephemeral chats.
 */
export async function resolveTimePackTarget({
  endpointOption,
  body,
}: TimePackTargetInput): Promise<{ endpoint: string | null; model: string | null }> {
  let agent: TargetAgent;
  try {
    agent = await endpointOption?.agent;
  } catch {
    /** The controller reports a failed agent load itself; route on the request fields. */
    agent = undefined;
  }
  return {
    endpoint:
      agent?.provider ||
      endpointOption?.endpoint ||
      endpointOption?.endpointType ||
      body?.endpoint ||
      null,
    model:
      agent?.model ||
      endpointOption?.modelOptions?.model ||
      endpointOption?.model_parameters?.model ||
      body?.model ||
      null,
  };
}
