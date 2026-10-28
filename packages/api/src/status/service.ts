import { serviceStatusSchema } from 'librechat-data-provider';
import type {
  TCustomConfig,
  TServiceId,
  TServiceHealth,
  TServiceStatus,
  TSearchChainProvider,
  TServiceStatusResponse,
} from 'librechat-data-provider';
import type { ChainCache, ChainStateStore } from '~/web/chain/state';
import type { ChainHttp } from '~/web/chain/types';
import type { ServiceProbe } from './fetchers';
import type { HistoryEntry } from './history';
import {
  probeSms,
  probeSerper,
  probeTavily,
  probeOllama,
  probeSerpApi,
  probeSearxng,
  probePayments,
  probeOpenRouter,
} from './fetchers';
import { appendHistory, estimateDaysFromCounts, estimateDaysLeft, parseHistory } from './history';
import { resolveChainCredentials, resolveDeploymentValue } from '~/web/chain/keys';

type Env = Readonly<Record<string, string | undefined>>;

interface StatusLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/** The parts of the app config the status service reads. */
export interface StatusConfig {
  webSearch?: TCustomConfig['webSearch'];
  serviceStatus?: TCustomConfig['serviceStatus'];
}

export interface ServiceStatusDeps {
  /** Shared cache (Redis when configured), so every replica serves the same snapshot. */
  cache: ChainCache;
  chainStore: ChainStateStore;
  loadConfig: () => Promise<StatusConfig>;
  http: ChainHttp;
  logger: StatusLogger;
  env?: Env;
  /**
   * Phone login's SMS balance (`getKavenegarBalance`), when that module is present: resolves
   * `{ remainingRial }` (`SmsBalance`), or null when SMS is not configured.
   */
  getSmsBalance?: () => Promise<unknown>;
  /** The payments module's gateway report (`getPaymentGatewaysStatus`), when present. */
  getPaymentGatewaysStatus?: () => Promise<unknown>;
  now?: () => number;
}

const SEARCH_IDS: readonly TSearchChainProvider[] = ['serper', 'serpapi', 'tavily', 'searxng'];
const SERVICE_IDS: readonly TServiceId[] = [
  ...SEARCH_IDS,
  'openrouter',
  'sms',
  'payments',
  'ollama',
];
const SNAPSHOT_KEY = 'snapshot';
const historyKey = (id: TServiceId) => `history:${id}`;
const DAY_MS = 24 * 60 * 60 * 1000;

interface Snapshot {
  checkedAt: number;
  probes: Partial<Record<TServiceId, ServiceProbe & { checkedAt: number }>>;
}

const isSearchId = (id: TServiceId): id is TSearchChainProvider =>
  (SEARCH_IDS as readonly string[]).includes(id);

function isSnapshot(value: unknown): value is Snapshot {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Snapshot).checkedAt === 'number' &&
    typeof (value as Snapshot).probes === 'object'
  );
}

export function computeHealth(
  status: Pick<
    TServiceStatus,
    | 'configured'
    | 'reachable'
    | 'remaining'
    | 'remainingPercent'
    | 'daysUntilExhausted'
    | 'skip'
    | 'errorCode'
  >,
  thresholds: { warningPercent: number; warningDays: number },
): TServiceHealth {
  if (!status.configured) {
    return 'unconfigured';
  }
  if (status.skip?.reason === 'exhausted' || (status.remaining != null && status.remaining <= 0)) {
    return 'exhausted';
  }
  if (status.reachable === false || status.skip?.reason === 'unauthorized') {
    return 'error';
  }
  if (
    status.errorCode != null ||
    status.skip?.reason === 'rate_limited' ||
    (status.remainingPercent != null && status.remainingPercent <= thresholds.warningPercent) ||
    (status.daysUntilExhausted != null && status.daysUntilExhausted <= thresholds.warningDays)
  ) {
    return 'warning';
  }
  return 'ok';
}

export interface ServiceStatusService {
  /** The cached snapshot with live failover state; checks every service first if none exists. */
  get(): Promise<TServiceStatusResponse>;
  /** Checks every service now. Concurrent calls share one run. */
  refresh(): Promise<TServiceStatusResponse>;
  /** Starts the background refresh; returns a stop function. Off unless `serviceStatus` is set. */
  start(): Promise<() => void>;
}

/**
 * Credit and health of the external services the deployment depends on, for the admin panel.
 * Checks run in the background or on an admin's request, never on the chat path; results and a
 * per-day `remaining` history live in the shared cache.
 */
export function createServiceStatusService(deps: ServiceStatusDeps): ServiceStatusService {
  const now = deps.now ?? Date.now;
  const env = deps.env ?? process.env;
  let inFlight: Promise<TServiceStatusResponse> | null = null;

  async function readSettings() {
    const config = await deps.loadConfig();
    return { config, settings: serviceStatusSchema.parse(config.serviceStatus ?? {}) };
  }

  async function runProbes(config: StatusConfig, timeoutMs: number): Promise<Snapshot> {
    const credentials = resolveChainCredentials(config.webSearch, env);
    const settings = serviceStatusSchema.parse(config.serviceStatus ?? {});
    const ctx = { http: deps.http, timeoutMs };
    const tasks: Record<TServiceId, () => Promise<ServiceProbe>> = {
      serper: () => probeSerper(ctx, credentials.serper),
      serpapi: () => probeSerpApi(ctx, credentials.serpapi),
      tavily: () => probeTavily(ctx, credentials.tavily),
      searxng: () => probeSearxng(ctx, credentials.searxng?.instanceUrl),
      openrouter: () =>
        probeOpenRouter(
          ctx,
          resolveDeploymentValue(settings.openRouterApiKey, env),
          resolveDeploymentValue(settings.openRouterManagementKey, env),
        ),
      sms: () => probeSms(deps.getSmsBalance),
      payments: () => probePayments(deps.getPaymentGatewaysStatus),
      ollama: () => probeOllama(ctx, settings.ollamaUrl),
    };
    const results = await Promise.all(
      SERVICE_IDS.map(async (id) => {
        try {
          return [id, await tasks[id]()] as const;
        } catch {
          return [id, { configured: true, reachable: false, errorCode: 'probe_failed' }] as const;
        }
      }),
    );
    const at = now();
    const probes: Snapshot['probes'] = {};
    for (const [id, probe] of results) {
      probes[id] = { ...probe, checkedAt: at };
    }
    return { checkedAt: at, probes };
  }

  /** Feeds the failover: reset dates for the exhaustion window, and a top-up ends an exhaustion. */
  async function syncChain(snapshot: Snapshot): Promise<void> {
    await Promise.all(
      SEARCH_IDS.map(async (id) => {
        const probe = snapshot.probes[id];
        if (!probe?.configured || probe.reachable !== true) {
          return;
        }
        const reset = probe.resetAt ? Date.parse(probe.resetAt) : NaN;
        await deps.chainStore.setResetHint(id, Number.isFinite(reset) ? reset : null);
        if (probe.remaining != null && probe.remaining > 0) {
          const skip = await deps.chainStore.getSkip(id, now());
          if (skip?.reason === 'exhausted') {
            await deps.chainStore.clearSkip(id);
          }
        }
      }),
    );
  }

  async function recordHistory(snapshot: Snapshot, historyDays: number): Promise<void> {
    await Promise.all(
      SERVICE_IDS.map(async (id) => {
        const remaining = snapshot.probes[id]?.remaining;
        if (remaining == null) {
          return;
        }
        const history = parseHistory(await deps.cache.get(historyKey(id)));
        const next = appendHistory(history, remaining, snapshot.checkedAt, historyDays);
        if (next !== history) {
          await deps.cache.set(historyKey(id), next, historyDays * DAY_MS);
        }
      }),
    );
  }

  async function compose(
    snapshot: Snapshot,
    config: StatusConfig,
  ): Promise<TServiceStatusResponse> {
    const settings = serviceStatusSchema.parse(config.serviceStatus ?? {});
    const chain = config.webSearch?.providerChain ?? [];
    const at = now();
    const [skips, histories, counts, active] = await Promise.all([
      Promise.all(SEARCH_IDS.map((id) => deps.chainStore.getSkip(id, at).catch(() => null))),
      Promise.all(
        SERVICE_IDS.map(async (id) => parseHistory(await deps.cache.get(historyKey(id)))),
      ),
      Promise.all(SEARCH_IDS.map((id) => deps.chainStore.getDailyUsage(id, 7, at).catch(() => []))),
      deps.chainStore.getActive().catch(() => null),
    ]);

    const services = SERVICE_IDS.map((id, index): TServiceStatus => {
      const probe = snapshot.probes[id];
      const searchIndex = SEARCH_IDS.indexOf(id as TSearchChainProvider);
      const skip = searchIndex >= 0 ? skips[searchIndex] : null;
      const remaining = probe?.remaining ?? null;
      const limit = probe?.limit ?? null;
      const history: HistoryEntry[] = histories[index];
      let daysUntilExhausted = remaining != null ? estimateDaysLeft(history, remaining, at) : null;
      if (daysUntilExhausted == null && remaining != null && searchIndex >= 0) {
        daysUntilExhausted = estimateDaysFromCounts(counts[searchIndex], remaining);
      }
      const status: TServiceStatus = {
        id,
        configured: probe?.configured ?? false,
        health: 'unconfigured',
        reachable: probe?.reachable ?? null,
        unit: probe?.unit,
        remaining,
        limit,
        remainingPercent:
          remaining != null && limit != null && limit > 0
            ? Math.max(0, Math.min(100, Math.round((remaining / limit) * 100)))
            : null,
        usedThisPeriod: probe?.usedThisPeriod ?? null,
        plan: probe?.plan ?? null,
        resetAt: probe?.resetAt ?? null,
        daysUntilExhausted,
        skip: skip
          ? { reason: skip.reason, until: new Date(skip.until).toISOString(), code: skip.code }
          : null,
        chainPosition: isSearchId(id) && chain.includes(id) ? chain.indexOf(id) + 1 : null,
        checkedAt: probe ? new Date(probe.checkedAt).toISOString() : null,
        errorCode: probe?.errorCode ?? skip?.code ?? null,
        details: probe?.details,
        models: probe?.models,
        loadedKnown: probe?.loadedKnown,
      };
      status.health = computeHealth(status, settings);
      return status;
    });

    const usable = chain.find((id) => {
      const status = services.find((service) => service.id === id);
      return status?.configured === true && status.skip == null;
    });
    return {
      services,
      activeSearchProvider: chain.length > 0 ? (usable ?? null) : null,
      chain: [...chain],
      lastServedBy: active
        ? { provider: active.provider, at: new Date(active.at).toISOString() }
        : null,
      warningPercent: settings.warningPercent,
      warningDays: settings.warningDays,
      refreshIntervalSeconds: settings.refreshIntervalSeconds,
      checkedAt: snapshot.checkedAt > 0 ? new Date(snapshot.checkedAt).toISOString() : null,
    };
  }

  async function doRefresh(): Promise<TServiceStatusResponse> {
    const { config, settings } = await readSettings();
    const snapshot = await runProbes(config, settings.timeoutMs);
    await deps.cache.set(
      SNAPSHOT_KEY,
      snapshot,
      Math.max(settings.refreshIntervalSeconds * 3, 3600) * 1000,
    );
    await Promise.all([
      syncChain(snapshot).catch((error: unknown) =>
        deps.logger.warn('[serviceStatus] Could not update search failover state', {
          error: error instanceof Error ? error.name : 'unknown',
        }),
      ),
      recordHistory(snapshot, settings.historyDays).catch((error: unknown) =>
        deps.logger.warn('[serviceStatus] Could not record usage history', {
          error: error instanceof Error ? error.name : 'unknown',
        }),
      ),
    ]);
    return compose(snapshot, config);
  }

  const refresh = (): Promise<TServiceStatusResponse> => {
    inFlight ??= doRefresh().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  return {
    refresh,
    async get() {
      const cached = await deps.cache.get(SNAPSHOT_KEY);
      if (!isSnapshot(cached)) {
        return refresh();
      }
      const { config } = await readSettings();
      return compose(cached, config);
    },
    async start() {
      const { config, settings } = await readSettings();
      if (config.serviceStatus == null) {
        return () => undefined;
      }
      const intervalMs = settings.refreshIntervalSeconds * 1000;
      const tick = async () => {
        const cached = await deps.cache.get(SNAPSHOT_KEY);
        /** Another replica refreshed recently: share its snapshot instead of checking again. */
        if (isSnapshot(cached) && now() - cached.checkedAt < intervalMs * 0.9) {
          return;
        }
        await refresh();
      };
      const run = () => {
        tick().catch((error: unknown) =>
          deps.logger.error('[serviceStatus] Background refresh failed', {
            error: error instanceof Error ? error.name : 'unknown',
          }),
        );
      };
      run();
      const timer = setInterval(run, intervalMs);
      timer.unref?.();
      return () => clearInterval(timer);
    },
  };
}
