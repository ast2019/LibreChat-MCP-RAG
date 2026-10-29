import type { TModelSpec } from 'librechat-data-provider';
import type { Agent } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { LoadAgentDeps, LoadAgentParams } from '~/agents/load';
import { loadEphemeralAgent } from '~/agents/load';

type ConfigCarrier = { config?: AppConfig };

/** Preset fields that describe how a spec looks in the app, not how its model runs. */
const PRESET_DISPLAY_FIELDS = new Set([
  'endpoint',
  'endpointType',
  'spec',
  'iconURL',
  'greeting',
  'title',
  'conversationId',
  'agent_id',
  'assistant_id',
]);

/**
 * The model spec an API caller named in `model`, among the specs this user can see (the config
 * is already narrowed by role and per-user model access). Null when no spec has that name.
 */
export function findApiModelSpec(req: ConfigCarrier, name: unknown): TModelSpec | null {
  if (typeof name !== 'string' || name === '') {
    return null;
  }
  const list = (req.config?.modelSpecs as { list?: TModelSpec[] } | undefined)?.list ?? [];
  const spec = list.find((item) => item.name === name);
  return spec?.preset?.endpoint ? spec : null;
}

/** The specs the user may call by name, as OpenAI-style model entries for `GET /v1/models`. */
export function listApiModelSpecs(req: ConfigCarrier): Array<{
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
  permission: never[];
  root: string;
  parent: null;
  name: string;
  description?: string;
  provider: string;
}> {
  const list = (req.config?.modelSpecs as { list?: TModelSpec[] } | undefined)?.list ?? [];
  return list
    .filter((spec) => spec.preset?.endpoint)
    .map((spec) => ({
      id: spec.name,
      object: 'model' as const,
      created: 0,
      owned_by: 'librechat',
      permission: [],
      root: spec.name,
      parent: null,
      name: spec.label ?? spec.name,
      ...(spec.description ? { description: spec.description } : {}),
      provider: String(spec.preset.endpoint),
    }));
}

/**
 * The agent an API call runs: a stored agent by id, or, when `model` names a model spec, the same
 * ephemeral agent a chat on that spec gets (its model, instructions and spec tools).
 */
export async function resolveApiAgent(
  req: LoadAgentParams['req'] & ConfigCarrier,
  model: string,
  deps: LoadAgentDeps,
): Promise<Agent | null> {
  const spec = findApiModelSpec(req, model);
  if (spec == null) {
    const agent = await deps.getAgent({ id: model });
    return (agent as Agent | null) ?? null;
  }
  const model_parameters: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(spec.preset ?? {})) {
    if (!PRESET_DISPLAY_FIELDS.has(key) && value != null) {
      model_parameters[key] = value;
    }
  }
  return loadEphemeralAgent(
    {
      req,
      spec: spec.name,
      endpoint: String(spec.preset.endpoint),
      model_parameters: model_parameters as LoadAgentParams['model_parameters'],
    },
    deps,
  );
}
