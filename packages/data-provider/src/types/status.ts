/** Services the admin status panel reports on. */
export type TServiceId =
  | 'serper'
  | 'serpapi'
  | 'tavily'
  | 'searxng'
  | 'openrouter'
  | 'sms'
  | 'payments'
  | 'ollama';

/**
 * `ok` healthy with room to spare; `warning` low (under the warning share or days); `exhausted`
 * out of quota or skipped by the search failover; `error` the last check failed;
 * `unconfigured` no key/URL set.
 */
export type TServiceHealth = 'ok' | 'warning' | 'exhausted' | 'error' | 'unconfigured';

/** What the quota is counted in. `usd` amounts are dollars, `rial` amounts are Rial. */
export type TServiceUnit = 'searches' | 'credits' | 'usd' | 'rial';

/** Why the search failover is skipping a provider. */
export type TSearchSkipReason = 'exhausted' | 'rate_limited' | 'unauthorized';

/** A model installed on the local Ollama server; `loaded` when it is in memory right now. */
export type TLocalModel = {
  name: string;
  /**
   * False when the model is loaded (`/api/ps`) but missing from the installed list (`/api/tags`),
   * e.g. removed from disk while still in memory. Absent means installed.
   */
  installed?: boolean;
  /** Size on disk in bytes; null when the model is not installed. */
  sizeBytes?: number | null;
  /** e.g. `4.3B`. */
  parameterSize?: string | null;
  /** e.g. `Q4_K_M`. */
  quantization?: string | null;
  family?: string | null;
  modifiedAt?: string | null;
  /** Loaded in memory at the last check; see `expiresAt` for whether it may have unloaded since. */
  loaded: boolean;
  /** Total memory the loaded model uses (RAM and GPU), in bytes. */
  memoryBytes?: number | null;
  /** The GPU share of `memoryBytes`, in bytes; 0 when the model runs on the CPU. */
  vramBytes?: number | null;
  /** When Ollama unloads the idle model. */
  expiresAt?: string | null;
};

export type TServiceStatus = {
  id: TServiceId;
  configured: boolean;
  health: TServiceHealth;
  /** Whether the service answered the last check; null when it was not checked. */
  reachable: boolean | null;
  unit?: TServiceUnit;
  remaining?: number | null;
  limit?: number | null;
  /** 0–100, rounded; null when the quota has no known limit. */
  remainingPercent?: number | null;
  usedThisPeriod?: number | null;
  plan?: string | null;
  resetAt?: string | null;
  /** Estimated days until `remaining` reaches zero from recent daily usage; null when unknown. */
  daysUntilExhausted?: number | null;
  /** Search failover state: skipped until `until`. */
  skip?: { reason: TSearchSkipReason; until: string; code?: string } | null;
  /** Position in `webSearch.providerChain`, or null when the chain does not use it. */
  chainPosition?: number | null;
  checkedAt?: string | null;
  /** Stable, secret-free code of the last failure (e.g. `http_401`, `timeout`). */
  errorCode?: string | null;
  /** Gateways the payments service reports, by name. */
  details?: { name: string; healthy: boolean; errorCode?: string | null }[];
  /** Ollama only: the installed models, loaded ones flagged and listed first. */
  models?: TLocalModel[];
  /** Ollama only: false when the loaded models could not be read, so `loaded` is unknown. */
  loadedKnown?: boolean;
};

export type TServiceStatusResponse = {
  services: TServiceStatus[];
  /** The search provider the chain would use now; null without a chain or when none is usable. */
  activeSearchProvider: string | null;
  chain: string[];
  /** The provider that answered the most recent chained search. */
  lastServedBy: { provider: string; at: string } | null;
  warningPercent: number;
  warningDays: number;
  refreshIntervalSeconds: number;
  /** When the slowest service was last checked; null before the first refresh. */
  checkedAt: string | null;
};
