import type { TModelSpec } from 'librechat-data-provider';

/** Default endpoints whose model calls stay on the deployment's own servers. */
export const DEFAULT_LOCAL_ENDPOINTS = [
  'Local',
  'LocalUncensored',
  'LocalUncensoredThink',
] as const;

/** Transaction `context` for a completed local chat turn (mirrors `ocr_local`). */
export const MESSAGE_LOCAL_TRANSACTION_CONTEXT = 'message_local';

export type LocalSpendSpec = Partial<
  Pick<TModelSpec, 'name' | 'privacy'> & { preset?: { endpoint?: string | null } }
>;

export type IsLocalChatSpendParams = {
  endpoint?: string | null;
  agentEndpoint?: string | null;
  spec?: string | null;
  specs?: ReadonlyArray<LocalSpendSpec> | null;
  localEndpoints?: readonly string[] | null;
};

function normalizeEndpoint(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Whether chat spend should be tagged as on-server (no provider cost): the model
 * spec says `privacy: 'local'`, or the conversation / agent / spec preset uses a
 * local endpoint.
 */
export function isLocalChatSpend({
  endpoint,
  agentEndpoint,
  spec,
  specs,
  localEndpoints,
}: IsLocalChatSpendParams): boolean {
  const modelSpec =
    typeof spec === 'string' && spec.length > 0
      ? specs?.find((entry) => entry?.name === spec)
      : undefined;
  if (modelSpec?.privacy === 'local') {
    return true;
  }
  const locals = new Set(
    (localEndpoints?.length ? localEndpoints : DEFAULT_LOCAL_ENDPOINTS).map(normalizeEndpoint),
  );
  return [endpoint, agentEndpoint, modelSpec?.preset?.endpoint].some(
    (name) => typeof name === 'string' && name !== '' && locals.has(normalizeEndpoint(name)),
  );
}

/**
 * Appends `_local` to a spend context when the run is on-server. Idempotent for
 * contexts that already end in `_local`.
 */
export function toLocalSpendContext(context: string, local: boolean): string {
  if (!local || context.endsWith('_local')) {
    return context;
  }
  return `${context}_local`;
}
