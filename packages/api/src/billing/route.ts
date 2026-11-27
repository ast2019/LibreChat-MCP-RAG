import {
  ErrorTypes,
  isTimePack,
  isTimePackEndpoint,
  isTimePackClaudeRequest,
  getActiveTimePackEntitlement,
  normalizeEndpointName,
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
  const timePacks = (packs ?? []).filter((entry) => isTimePack(entry));
  const pack = packs?.find((entry) => entry.id === entitlement.timePackId);
  /**
   * The configured pack endpoint is the canonical gateway. A user document may still carry a
   * stale name (ClaudeTime3D) or a pack id that no longer matches a row; without this the
   * holder's entitlement never matches the real endpoint and routing falls to `none`.
   */
  const configuredEndpoints = timePacks
    .map((entry) => entry.endpoint?.trim())
    .filter((name): name is string => typeof name === 'string' && name !== '');
  const canonical =
    (typeof pack?.endpoint === 'string' && pack.endpoint.trim() !== ''
      ? pack.endpoint.trim()
      : null) ??
    (configuredEndpoints.includes(entitlement.timePackEndpoint) ? null : configuredEndpoints[0]) ??
    null;
  const resolved =
    canonical != null && canonical !== entitlement.timePackEndpoint
      ? { ...entitlement, timePackEndpoint: canonical }
      : entitlement;
  return pack?.models != null && pack.models.length > 0
    ? { ...resolved, models: [...pack.models] }
    : resolved;
}

/**
 * Whether `endpoint` is the plan's dedicated Claude path: a configured `kind: time` pack
 * names it, or the signed-in user's active entitlement does. The entitlement check keeps
 * seat admission alive when an admin pack list dropped `kind: time` but grants remain.
 */
export function isTimePackRouteEndpoint({
  packs,
  endpoint,
  entitlement,
}: {
  packs?: readonly TimePackRoutePack[] | null;
  endpoint?: string | null;
  entitlement?: TimePackEntitlement | null;
}): boolean {
  if (isTimePackEndpoint(packs, endpoint)) {
    return true;
  }
  return (
    entitlement != null &&
    typeof endpoint === 'string' &&
    endpoint !== '' &&
    endpoint === entitlement.timePackEndpoint
  );
}

export type TimePackConfigLike = {
  balance?: { packs?: readonly TimePackRoutePack[] | null } | null;
  modelSpecs?: {
    list?: readonly {
      name?: string | null;
      timePack?: boolean;
      preset?: { endpoint?: string | null; model?: string | null } | null;
    }[] | null;
  } | null;
};

/** Endpoint names declared by `kind: time` packs and `timePack` model specs. */
export function listConfiguredTimePackEndpoints(
  config?: TimePackConfigLike | null,
): string[] {
  const names = new Set<string>();
  for (const pack of config?.balance?.packs ?? []) {
    if (!isTimePack(pack)) {
      continue;
    }
    const endpoint = pack.endpoint?.trim();
    if (endpoint) {
      names.add(normalizeEndpointName(endpoint));
    }
  }
  for (const spec of config?.modelSpecs?.list ?? []) {
    if (spec?.timePack !== true) {
      continue;
    }
    const endpoint =
      typeof spec.preset?.endpoint === 'string' ? spec.preset.endpoint.trim() : '';
    if (endpoint) {
      names.add(normalizeEndpointName(endpoint));
    }
  }
  return [...names];
}

/** Whether `endpoint` is a configured time-pack gateway path (independent of the user's plan). */
export function isConfiguredTimePackEndpoint(
  endpoint: string | null | undefined,
  config?: TimePackConfigLike | null,
): boolean {
  if (endpoint == null || endpoint === '') {
    return false;
  }
  const key = normalizeEndpointName(endpoint);
  return listConfiguredTimePackEndpoints(config).includes(key);
}

/**
 * Single ingress/egress name for time-pack turns. Prefer the unanimous `timePack` modelSpec
 * preset (menu → ClaudeTime) over a stale `balance.packs` / user rename (ClaudeTime3D).
 */
export function resolveCanonicalTimePackGateway({
  config,
  packId,
}: {
  config?: TimePackConfigLike | null;
  packId?: string | null;
}): string | null {
  const fromSpecs = [
    ...new Set(
      (config?.modelSpecs?.list ?? [])
        .filter((spec) => spec?.timePack === true)
        .map((spec) =>
          typeof spec.preset?.endpoint === 'string' ? spec.preset.endpoint.trim() : '',
        )
        .filter((endpoint) => endpoint !== ''),
    ),
  ];
  if (fromSpecs.length === 1) {
    return fromSpecs[0];
  }
  const packs = config?.balance?.packs ?? [];
  const id = typeof packId === 'string' ? packId.trim() : '';
  if (id) {
    const pack = packs.find((entry) => entry.id === id && isTimePack(entry));
    const fromPack = typeof pack?.endpoint === 'string' ? pack.endpoint.trim() : '';
    if (fromPack) {
      return fromPack;
    }
  }
  if (fromSpecs[0]) {
    return fromSpecs[0];
  }
  for (const pack of packs) {
    if (!isTimePack(pack)) {
      continue;
    }
    const endpoint = typeof pack.endpoint === 'string' ? pack.endpoint.trim() : '';
    if (endpoint) {
      return endpoint;
    }
  }
  return null;
}

/** Classifies a request (or one agent of it) by its real endpoint and model. */
export function resolveTimePackRoute({
  user,
  endpoint,
  model,
  packs,
  config,
  now,
}: {
  user?: TimePackAdmitUser | null;
  endpoint?: string | null;
  model?: string | null;
  packs?: readonly TimePackRoutePack[] | null;
  /** When set, modelSpec timePack presets win over a renamed pack/user endpoint. */
  config?: TimePackConfigLike | null;
  now?: Date;
}): TimePackRoute {
  const packList = packs ?? config?.balance?.packs ?? null;
  const routeConfig: TimePackConfigLike =
    config ?? ({ balance: { packs: packList } } satisfies TimePackConfigLike);
  let entitlement = getTimePackEntitlement(user, packList, now);
  const canonical = resolveCanonicalTimePackGateway({
    config: routeConfig,
    packId: entitlement?.timePackId ?? (typeof user?.timePackId === 'string' ? user.timePackId : null),
  });
  /**
   * Stale grant/pack names (ClaudeTime3D) must not block the configured pipe (ClaudeTime).
   * Align the in-memory entitlement before the exact endpoint match in isTimePackClaudeRequest.
   */
  if (entitlement != null && canonical != null && entitlement.timePackEndpoint !== canonical) {
    entitlement = { ...entitlement, timePackEndpoint: canonical };
  }
  const onPath =
    isConfiguredTimePackEndpoint(endpoint, routeConfig) ||
    isTimePackRouteEndpoint({ packs: packList, endpoint, entitlement });
  if (!onPath) {
    return { kind: 'none' };
  }
  if (isTimePackClaudeRequest({ entitlement, endpoint, model })) {
    return { kind: 'seat', entitlement: entitlement as TimePackEntitlement };
  }
  return { kind: 'denied', code: ErrorTypes.TIME_PACK_REQUIRED };
}

type TargetAgent = {
  /** Configured endpoint name (survives the SDK provider swap in initializeAgent). */
  endpoint?: string | null;
  provider?: string | null;
  model?: string | null;
} | null | undefined;

export type TimePackTargetInput = {
  /** `endpointOption` from the agents route; `agent` is the agent being loaded (a promise). */
  endpointOption?: {
    endpoint?: string | null;
    endpointType?: string | null;
    spec?: string | null;
    agent?: TargetAgent | Promise<TargetAgent>;
    modelOptions?: { model?: string | null } | null;
    model_parameters?: { model?: string | null } | null;
  } | null;
  body?: { endpoint?: string | null; model?: string | null; spec?: string | null } | null;
  /** Live app config — used to resolve `timePack` modelSpec presets when the agent is still
   *  on the agents route name. */
  config?: TimePackConfigLike | null;
};

type TimePackModelSpec = {
  name?: string | null;
  timePack?: boolean;
  preset?: { endpoint?: string | null; model?: string | null } | null;
};

/**
 * When the selected modelSpec is a time-pack preset, its `preset.endpoint` / `model` are the
 * real gateway target — even if the agents route still says `agents` on the wire.
 */
export function resolveTimePackSpecTarget({
  endpointOption,
  body,
  config,
}: Pick<TimePackTargetInput, 'endpointOption' | 'body' | 'config'>): {
  endpoint: string | null;
  model: string | null;
  timePack: boolean;
} {
  const specName = endpointOption?.spec ?? body?.spec;
  if (typeof specName !== 'string' || specName === '') {
    return { endpoint: null, model: null, timePack: false };
  }
  const list = (config?.modelSpecs?.list ?? []) as TimePackModelSpec[];
  const modelSpec = list.find((entry) => entry?.name === specName);
  if (modelSpec == null) {
    return { endpoint: null, model: null, timePack: false };
  }
  const endpoint =
    typeof modelSpec.preset?.endpoint === 'string' && modelSpec.preset.endpoint.trim() !== ''
      ? modelSpec.preset.endpoint.trim()
      : null;
  const model =
    typeof modelSpec.preset?.model === 'string' && modelSpec.preset.model.trim() !== ''
      ? modelSpec.preset.model.trim()
      : null;
  return { endpoint, model, timePack: modelSpec.timePack === true };
}

/**
 * The endpoint and model a request really runs on. Prefer `agent.endpoint` (ClaudeTime) over
 * `agent.provider` — initialize swaps provider to the SDK name (`anthropic`) while keeping the
 * configured endpoint on `endpoint`. Fall back to a `timePack` modelSpec preset, then the
 * route / body for ephemeral chats.
 */
export async function resolveTimePackTarget({
  endpointOption,
  body,
  config,
}: TimePackTargetInput): Promise<{ endpoint: string | null; model: string | null }> {
  let agent: TargetAgent;
  try {
    agent = await endpointOption?.agent;
  } catch {
    /** The controller reports a failed agent load itself; route on the request fields. */
    agent = undefined;
  }
  const fromSpec = resolveTimePackSpecTarget({ endpointOption, body, config });
  const endpoint =
    agent?.endpoint ||
    agent?.provider ||
    (fromSpec.timePack ? fromSpec.endpoint : null) ||
    endpointOption?.endpoint ||
    endpointOption?.endpointType ||
    body?.endpoint ||
    fromSpec.endpoint ||
    null;
  /** Never treat the agents router name as the time-pack gateway when a timePack spec
   *  already named ClaudeTime — that miss left `_timePackEntitlement` unset and BaseClient
   *  fail-closed with `time_pack_required` for holders. */
  const resolvedEndpoint =
    (endpoint === 'agents' || endpoint === 'Agents') && fromSpec.timePack && fromSpec.endpoint
      ? fromSpec.endpoint
      : endpoint;
  return {
    endpoint: resolvedEndpoint,
    model:
      agent?.model ||
      endpointOption?.modelOptions?.model ||
      endpointOption?.model_parameters?.model ||
      body?.model ||
      fromSpec.model ||
      null,
  };
}
