import type { TModelQuickPickGroup, TModelSpec } from 'librechat-data-provider';

/** One landing group after unknown or inaccessible specs are dropped. */
export type ResolvedQuickPickGroup = {
  id: string;
  specs: TModelSpec[];
};

/**
 * Resolves configured landing quick-picks against the specs the user can see.
 * Missing names are skipped; a group with nothing left is omitted. Order of
 * groups and of specs inside each group follows the config.
 */
export function resolveQuickPicks(
  groups: TModelQuickPickGroup[] | undefined,
  list: TModelSpec[] | undefined,
): ResolvedQuickPickGroup[] {
  if (!groups?.length || !list?.length) {
    return [];
  }

  const byName = new Map<string, TModelSpec>();
  for (const spec of list) {
    byName.set(spec.name, spec);
  }

  const resolved: ResolvedQuickPickGroup[] = [];
  for (const group of groups) {
    const specs: TModelSpec[] = [];
    for (const name of group.specs) {
      const spec = byName.get(name);
      if (spec) {
        specs.push(spec);
      }
    }
    if (specs.length > 0) {
      resolved.push({ id: group.id, specs });
    }
  }
  return resolved;
}
