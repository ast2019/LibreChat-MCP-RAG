import { normalizeEndpointName } from 'librechat-data-provider';
import type { TModelSpec } from 'librechat-data-provider';
import type { OcrRoute } from './types';

const ROUTE_RANK: Readonly<Record<OcrRoute, number>> = { public: 0, private: 1, local: 2 };

/** The more restrictive of two routes: `local` > `private` > `public`. */
export function strictestOcrRoute(a: OcrRoute, b: OcrRoute): OcrRoute {
  return ROUTE_RANK[b] > ROUTE_RANK[a] ? b : a;
}

function matches(list: readonly string[], endpoint: string | null | undefined): boolean {
  if (!endpoint) {
    return false;
  }
  const name = normalizeEndpointName(endpoint);
  return list.some((entry) => normalizeEndpointName(entry) === name);
}

export interface OcrRouteSource {
  endpoint?: string | null;
  spec?: string | null;
}

/** The spec fields a route reads; app config specs arrive partially typed. */
type RouteSpec = Partial<Pick<TModelSpec, 'name' | 'privacy'>> & {
  preset?: { endpoint?: string | null } | null;
};

export interface OcrRouteContext {
  specs?: ReadonlyArray<RouteSpec> | null;
  /** `documentOcr.localEndpoints`: endpoints whose chats never leave the server. */
  localEndpoints: readonly string[];
  /** `documentOcr.privateEndpoints`: endpoints that only reach zero-data-retention providers. */
  privateEndpoints: readonly string[];
}

/**
 * Route of one conversation state: the spec's `privacy` (or the endpoint its preset names) and
 * the endpoint itself both count, and the stricter one wins, so an unknown or stale spec never
 * makes a private or local endpoint public.
 */
export function resolveOcrRoute(source: OcrRouteSource, context: OcrRouteContext): OcrRoute {
  const spec = source.spec
    ? context.specs?.find((entry) => entry?.name === source.spec)
    : undefined;
  const endpoints = [source.endpoint, spec?.preset?.endpoint];
  const uses = (list: readonly string[]) => endpoints.some((name) => matches(list, name));
  if (spec?.privacy === 'local' || uses(context.localEndpoints)) {
    return 'local';
  }
  if (spec?.privacy === 'private' || uses(context.privateEndpoints)) {
    return 'private';
  }
  return 'public';
}

export interface UploadOcrRouteParams extends OcrRouteContext {
  /** What the upload request names: the composer's current endpoint and spec. */
  requested: OcrRouteSource;
  /** The persisted conversation, when the upload names one that exists. */
  stored?: OcrRouteSource | null;
}

/**
 * Route for a file uploaded into a conversation. The stored conversation decides, and the request
 * can only make it stricter: a private conversation stays private even if the composer reports a
 * public spec, and switching a public chat to the local model keeps its uploads on the server.
 */
export function resolveUploadOcrRoute({
  requested,
  stored,
  ...context
}: UploadOcrRouteParams): OcrRoute {
  const fromRequest = resolveOcrRoute(requested, context);
  return stored ? strictestOcrRoute(resolveOcrRoute(stored, context), fromRequest) : fromRequest;
}
