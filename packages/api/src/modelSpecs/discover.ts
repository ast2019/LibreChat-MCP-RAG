import { logger } from '@librechat/data-schemas';
import {
  EModelEndpoint,
  normalizeEndpointName,
  autoDiscoverConfigSchema,
} from 'librechat-data-provider';
import type { TModelSpec, TAutoDiscoverConfig } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';

/** One catalogue entry, reduced to the fields discovery reads. */
export interface CatalogueModel {
  id: string;
  /** Display name, e.g. `Anthropic: Claude Sonnet 5.5`. */
  name?: string;
  /** Unix seconds. */
  created?: number;
  /** `architecture.input_modalities`, e.g. `['text', 'image', 'file']`; absent when unknown. */
  inputModalities?: readonly string[];
}

/**
 * The model catalogue as last fetched. `models` and `zdr` are `null` until their first
 * successful fetch; a failed refresh keeps the previous value.
 */
export interface ModelCatalogueSnapshot {
  /** Changes whenever either list is replaced. */
  version: number;
  models: readonly CatalogueModel[] | null;
  /** Model ids with at least one Zero Data Retention endpoint. */
  zdr: ReadonlySet<string> | null;
}

export interface ModelFamily {
  provider: string;
  family: string;
  /** Numeric version parts (`[5, 5]` for 5.5); empty for an alias. */
  version: number[];
}

export const DEFAULT_AUTO_DESCRIPTION = 'جدید؛ خودکار از فهرست {group} اضافه شد';
export const DEFAULT_PRIVATE_GROUP = 'محرمانه';
export const DEFAULT_PRIVATE_LABEL_SUFFIX = ' — محرمانه';
export const DEFAULT_PRIVATE_DESCRIPTION =
  'روی سرورهایی که داده نگه نمی‌دارند (ZDR)؛ خودکار اضافه شد';

const ALIAS_PATTERN = /^~([a-z0-9][a-z0-9._-]*)\/([a-z0-9][a-z0-9._-]*?)-latest$/;
const CONCRETE_PATTERN = /^([a-z0-9][a-z0-9._-]*)\/([a-z0-9][a-z0-9._-]*)$/;
const VERSION_TOKEN = /^\d+(?:\.\d+)*$/;

/** `~openai/gpt-terra-latest` → `{ provider: 'openai', family: 'gpt-terra' }`; else `null`. */
export function parseAliasFamily(id: string): ModelFamily | null {
  const match = ALIAS_PATTERN.exec(id);
  if (!match) {
    return null;
  }
  return { provider: match[1], family: match[2], version: [] };
}

/**
 * The family of a concrete, versioned model id: its name tokens with the one version token
 * removed. `anthropic/claude-sonnet-5.5` → `claude-sonnet`, `openai/gpt-6.1-sol` → `gpt-sol`,
 * `google/gemini-3.8-flash` → `gemini-flash`. Extra tokens stay in the family
 * (`gemini-3.1-pro-preview` → `gemini-pro-preview`), so they never match a shorter family.
 * Returns `null` for aliases, `:variant` ids (`:batch`, `:free`), and ids with no version or
 * several numeric tokens (dates, `gpt-4o`).
 */
export function parseModelFamily(id: string): ModelFamily | null {
  const match = CONCRETE_PATTERN.exec(id);
  if (!match) {
    return null;
  }
  const tokens = match[2].split('-');
  const versions = tokens.filter((token) => VERSION_TOKEN.test(token));
  if (versions.length !== 1) {
    return null;
  }
  const family = tokens.filter((token) => !VERSION_TOKEN.test(token)).join('-');
  if (!family) {
    return null;
  }
  return { provider: match[1], family, version: versions[0].split('.').map(Number) };
}

function compareVersions(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/** Catalogue name without the `Provider: ` prefix (and an alias's trailing ` Latest`). */
/**
 * The menu group for a provider missing from `providers`: the provider as the catalogue names
 * it (`Moonshot AI: Kimi Latest` → `Moonshot AI`), else the prefix title-cased
 * (`moonshotai` → `Moonshotai`).
 */
export function providerGroupName(model: CatalogueModel, provider: string): string {
  const raw = model.name?.trim() ?? '';
  const separator = raw.indexOf(': ');
  if (separator > 0) {
    return raw.slice(0, separator).trim();
  }
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

export function prettyModelName(model: CatalogueModel): string {
  const raw = model.name?.trim() || model.id.replace(/^~/, '').split('/').pop() || model.id;
  const separator = raw.indexOf(': ');
  const name = separator >= 0 ? raw.slice(separator + 2) : raw;
  return name.replace(/\s+Latest$/i, '').trim() || raw;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

type Spec = TModelSpec;

/** Inserts `additions` after the last spec of `group`, else at `fallbackIndex()`. */
function insertIntoGroup(
  list: Spec[],
  group: string,
  additions: Spec[],
  fallbackIndex: () => number,
): void {
  let index = -1;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.group === group) {
      index = i + 1;
      break;
    }
  }
  list.splice(index >= 0 ? index : fallbackIndex(), 0, ...additions);
}

function hasCustomEndpoint(config: AppConfig, name: string | undefined): name is string {
  if (!name) {
    return false;
  }
  const normalized = normalizeEndpointName(name);
  const custom = (config.endpoints?.[EModelEndpoint.custom] ?? []) as Array<{ name?: string }>;
  return custom.some((endpoint) => normalizeEndpointName(endpoint?.name) === normalized);
}

interface DiscoveryContext {
  config: AppConfig;
  settings: TAutoDiscoverConfig;
  snapshot: ModelCatalogueSnapshot;
  exclude: Set<string>;
  names: Set<string>;
}

function uniqueName(base: string, names: Set<string>): string | null {
  if (!names.has(base)) {
    names.add(base);
    return base;
  }
  return null;
}

/** Public specs for the catalogue's `~{provider}/{family}-latest` aliases no spec offers. */
function addPublicSpecs(list: Spec[], ctx: DiscoveryContext): boolean {
  const { config, settings, snapshot, exclude, names } = ctx;
  const models = snapshot.models;
  if (!models || !hasCustomEndpoint(config, settings.endpoint)) {
    return false;
  }
  const endpoint = normalizeEndpointName(settings.endpoint);
  const privateGroup = settings.private?.group ?? DEFAULT_PRIVATE_GROUP;
  const covered = new Set(list.map((spec) => spec?.preset?.model).filter(Boolean));
  const template = settings.description ?? DEFAULT_AUTO_DESCRIPTION;
  const byGroup = new Map<string, Spec[]>();

  const aliases = models
    .filter((model) => model.id.startsWith('~'))
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0) || a.id.localeCompare(b.id));

  /** Groups of providers missing from `settings.providers`, in the order first met. */
  const otherGroups: string[] = [];
  const listedGroups = new Set(Object.values(settings.providers).map((p) => p.group));
  for (const model of aliases) {
    const parsed = parseAliasFamily(model.id);
    let provider = parsed ? settings.providers[parsed.provider] : undefined;
    if (parsed && !provider && settings.otherProviders === true) {
      const group = providerGroupName(model, parsed.provider);
      /** Never folded into a configured brand's group or the confidential one by name alone. */
      if (!listedGroups.has(group) && group !== privateGroup) {
        provider = { group };
        if (!otherGroups.includes(group)) {
          otherGroups.push(group);
        }
      }
    }
    /** A public spec never joins the confidential group. */
    if (!parsed || !provider || provider.group === privateGroup) {
      continue;
    }
    if (exclude.has(model.id) || covered.has(model.id)) {
      continue;
    }
    const name = uniqueName(`auto-${slug(parsed.provider)}-${slug(parsed.family)}`, names);
    if (!name) {
      continue;
    }
    const label = prettyModelName(model);
    const spec: Spec = {
      name,
      label,
      description: template.replace(/\{group\}/g, provider.group),
      group: provider.group,
      ...(provider.icon && { iconURL: provider.icon }),
      webSearch: true,
      fileSearch: true,
      ...(model.created != null && { discoveredAt: model.created }),
      preset: { endpoint, model: model.id, modelLabel: label } as Spec['preset'],
    };
    const additions = byGroup.get(provider.group) ?? [];
    additions.push(spec);
    byGroup.set(provider.group, additions);
  }

  if (byGroup.size === 0) {
    return false;
  }

  const providerGroups = new Set(Object.values(settings.providers).map((p) => p.group));
  const fallbackIndex = () => {
    if (settings.insertBeforeGroup) {
      const before = list.findIndex((spec) => spec?.group === settings.insertBeforeGroup);
      if (before >= 0) {
        return before;
      }
    }
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i]?.group && providerGroups.has(list[i].group as string)) {
        return i + 1;
      }
    }
    return list.length;
  };

  /** Provider order decides where several new groups land relative to each other. */
  for (const { group, icon } of Object.values(settings.providers)) {
    const additions = byGroup.get(group);
    if (!additions) {
      continue;
    }
    byGroup.delete(group);
    const isNewGroup = !list.some((spec) => spec?.group === group);
    if (isNewGroup && icon) {
      additions[0] = { ...additions[0], groupIcon: icon };
    }
    insertIntoGroup(list, group, additions, fallbackIndex);
  }
  /** Then providers nobody listed, after the listed ones. */
  for (const group of otherGroups) {
    const additions = byGroup.get(group);
    if (!additions) {
      continue;
    }
    byGroup.delete(group);
    insertIntoGroup(list, group, additions, fallbackIndex);
  }
  return true;
}

interface FamilyBest {
  model: CatalogueModel;
  parsed: ModelFamily;
}

function isNewer(candidate: FamilyBest, current: FamilyBest): boolean {
  const createdDiff = (candidate.model.created ?? 0) - (current.model.created ?? 0);
  if (createdDiff !== 0 && candidate.model.created != null && current.model.created != null) {
    return createdDiff > 0;
  }
  return compareVersions(candidate.parsed.version, current.parsed.version) > 0;
}

/**
 * Confidential specs. Strict by construction: a private spec on an OpenRouter-routed endpoint
 * only ever names a concrete model id that is in the ZDR list.
 */
function applyPrivateSpecs(list: Spec[], ctx: DiscoveryContext): boolean {
  const { config, settings, snapshot, exclude, names } = ctx;
  const zdr = snapshot.zdr;
  const privateSettings = settings.private;
  if (!zdr || !privateSettings?.enabled) {
    return false;
  }

  const routed = new Set(
    [settings.endpoint, settings.privateEndpoint]
      .filter((name): name is string => !!name)
      .map((name) => normalizeEndpointName(name)),
  );
  const families = new Set(privateSettings.families);
  const catalogue = new Map<string, CatalogueModel>();
  const best = new Map<string, FamilyBest>();
  for (const model of snapshot.models ?? []) {
    catalogue.set(model.id, model);
    const parsed = parseModelFamily(model.id);
    if (!parsed || !families.has(parsed.family) || !zdr.has(model.id) || exclude.has(model.id)) {
      continue;
    }
    const candidate = { model, parsed };
    const current = best.get(parsed.family);
    if (!current || isNewer(candidate, current)) {
      best.set(parsed.family, candidate);
    }
  }

  let changed = false;
  const coveredFamilies = new Set<string>();
  for (let i = list.length - 1; i >= 0; i--) {
    const spec = list[i];
    if (spec?.privacy !== 'private') {
      continue;
    }
    const endpoint = spec.preset?.endpoint;
    if (!endpoint || !routed.has(normalizeEndpointName(endpoint))) {
      continue;
    }
    const model = spec.preset?.model;
    if (!model || !zdr.has(model)) {
      logger.warn(
        `[modelSpecs.autoDiscover] Removed private spec "${spec.name}": model "${model ?? ''}" has no Zero Data Retention endpoint`,
      );
      list.splice(i, 1);
      changed = true;
      continue;
    }
    const parsed = parseModelFamily(model);
    if (!parsed || !families.has(parsed.family)) {
      continue;
    }
    coveredFamilies.add(parsed.family);
    const newest = best.get(parsed.family);
    const current = { model: catalogue.get(model) ?? { id: model }, parsed };
    if (newest && newest.model.id !== model && isNewer(newest, current)) {
      list[i] = { ...spec, preset: { ...spec.preset, model: newest.model.id } };
      changed = true;
    }
  }

  const privateEndpoint = settings.privateEndpoint;
  if (!hasCustomEndpoint(config, privateEndpoint)) {
    return changed;
  }
  const group = privateSettings.group ?? DEFAULT_PRIVATE_GROUP;
  const suffix = privateSettings.labelSuffix ?? DEFAULT_PRIVATE_LABEL_SUFFIX;
  const description = privateSettings.description ?? DEFAULT_PRIVATE_DESCRIPTION;
  const additions: Spec[] = [];
  for (const family of privateSettings.families) {
    const newest = best.get(family);
    if (!newest || coveredFamilies.has(family)) {
      continue;
    }
    coveredFamilies.add(family);
    const name = uniqueName(`auto-private-${slug(family)}`, names);
    if (!name) {
      continue;
    }
    const label = `${prettyModelName(newest.model)}${suffix}`;
    const icon = settings.providers[newest.parsed.provider]?.icon;
    additions.push({
      name,
      label,
      description,
      privacy: 'private',
      group,
      ...(icon && { iconURL: icon }),
      hideBadgeRow: true,
      preset: {
        endpoint: normalizeEndpointName(privateEndpoint),
        model: newest.model.id,
        modelLabel: label,
      } as Spec['preset'],
    });
  }
  if (additions.length === 0) {
    return changed;
  }
  const isNewGroup = !list.some((spec) => spec?.group === group);
  if (isNewGroup && privateSettings.groupIcon) {
    additions[0] = { ...additions[0], groupIcon: privateSettings.groupIcon };
  }
  insertIntoGroup(list, group, additions, () => list.length);
  return true;
}

const applied = new WeakMap<AppConfig, { snapshot: ModelCatalogueSnapshot; result: AppConfig }>();

/**
 * The config with catalogue-discovered specs added (and private specs upgraded or removed),
 * per `modelSpecs.autoDiscover`. Pure apart from a memo keyed by the config object and the
 * snapshot, so a cached config costs one lookup per read. Apply before the access filters
 * (`applyAdminOnlySpecs`, `applyPrivacyAccessSpecs`) so they see the added specs.
 */
export function applyAutoDiscoveredSpecs(
  config: AppConfig,
  snapshot: ModelCatalogueSnapshot | null | undefined,
): AppConfig {
  const raw = config?.modelSpecs?.autoDiscover;
  const list = config?.modelSpecs?.list;
  if (!snapshot || raw?.enabled !== true || !Array.isArray(list)) {
    return config;
  }
  const memo = applied.get(config);
  if (memo?.snapshot === snapshot) {
    return memo.result;
  }
  /** Fills defaults a partial (DB-override) section leaves out */
  const parsed = autoDiscoverConfigSchema.safeParse(raw);
  if (!parsed.success) {
    applied.set(config, { snapshot, result: config });
    return config;
  }
  const settings = parsed.data;

  const next = [...list] as Spec[];
  const ctx: DiscoveryContext = {
    config,
    settings,
    snapshot,
    exclude: new Set(settings.exclude ?? []),
    names: new Set(list.map((spec) => spec?.name).filter((name): name is string => !!name)),
  };
  /** Private first: public additions never touch private specs, and vice versa. */
  const privateChanged = applyPrivateSpecs(next, ctx);
  const publicChanged = addPublicSpecs(next, ctx);
  const result =
    privateChanged || publicChanged
      ? ({ ...config, modelSpecs: { ...config.modelSpecs, list: next } } as AppConfig)
      : config;
  applied.set(config, { snapshot, result });
  return result;
}
