import type { ResolvedModelUsage } from '~/agents/usage';
import { getResponseResolvedModel } from '~/agents/usage';

/**
 * Which concrete model each configured (alias) model id last resolved to, as the provider
 * reported on a real response — e.g. OpenRouter's `~anthropic/claude-sonnet-latest` →
 * `anthropic/claude-sonnet-5.5`. Only observed ids are kept; nothing is inferred from a
 * catalogue. The default registry is process-local and empty after a restart: an instance
 * learns again from its next response, and each replica reports what it saw itself.
 */
export interface ResolvedModelRegistry {
  /** Remember that `requested` answered as `resolved`; ignored when they are the same id. */
  record(requested: string | undefined, resolved: string): void;
  get(requested: string): string | undefined;
}

export interface ResolvedModelRegistryOptions {
  /** Most configured ids kept; the least recently updated one is dropped beyond it. */
  maxEntries?: number;
}

const DEFAULT_MAX_ENTRIES = 500;

export function createResolvedModelRegistry(
  options: ResolvedModelRegistryOptions = {},
): ResolvedModelRegistry {
  const maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
  const entries = new Map<string, string>();
  return {
    record(requested, resolved) {
      if (!requested || !resolved || requested === resolved) {
        return;
      }
      /** Re-inserting moves the key to the end, so eviction drops the stalest id */
      entries.delete(requested);
      entries.set(requested, resolved);
      if (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest != null) {
          entries.delete(oldest);
        }
      }
    },
    get(requested) {
      return entries.get(requested);
    },
  };
}

/** The process-wide registry the chat path writes and the token-config route reads. */
export const resolvedModels: ResolvedModelRegistry = createResolvedModelRegistry();

/**
 * The concrete model that answered this turn (see {@link getResponseResolvedModel}), recorded
 * against the configured id it was requested as. Returns the id to persist on the response
 * message, or undefined when the provider reported none.
 */
export function captureResolvedModel(
  collectedUsage?: ReadonlyArray<ResolvedModelUsage | null | undefined> | null,
  registry: ResolvedModelRegistry = resolvedModels,
): string | undefined {
  const found = getResponseResolvedModel(collectedUsage);
  if (!found) {
    return undefined;
  }
  registry.record(found.requested, found.resolved);
  return found.resolved;
}
