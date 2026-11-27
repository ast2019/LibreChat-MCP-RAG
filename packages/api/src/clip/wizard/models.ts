import { normalizeEndpointName } from 'librechat-data-provider';
import type { TClipWizardModel, TClipToolsConfig, TModelSpec } from 'librechat-data-provider';
import type { ServerRequest } from '~/types';

export interface WizardModel extends TClipWizardModel {
  /** The provider's model id the spec resolves to; never sent to the client */
  model: string;
}

/** The menu group the Claude time pack specs live in; the wizard never offers it. */
const TIME_PACK_GROUP = 'ClaudeTime';

type Spec = Partial<TModelSpec>;

const usable = (spec: Spec, endpoint: string): boolean =>
  typeof spec?.name === 'string' &&
  typeof spec.preset?.model === 'string' &&
  spec.preset.model !== '' &&
  normalizeEndpointName(String(spec.preset.endpoint ?? '')) === normalizeEndpointName(endpoint) &&
  spec.privacy !== 'local' &&
  spec.timePack !== true &&
  spec.group !== TIME_PACK_GROUP;

/**
 * The models this user may draft with: the app's own model list on the wizard's LLM endpoint.
 * `req.config.modelSpecs` is already filtered for this user (admin-only specs, local and private
 * classes, time pack specs), so this adds only the wizard's own rules: the right endpoint, no
 * local spec, and nothing from the Claude time pack, whose seats the wizard never uses.
 */
export function listWizardModels(
  req: ServerRequest,
  config: Pick<TClipToolsConfig, 'wizard'>,
): WizardModel[] {
  const list = req.config?.modelSpecs?.list;
  if (!Array.isArray(list)) {
    return [];
  }
  const endpoint = config.wizard.llm.endpoint;
  const models: WizardModel[] = [];
  for (const spec of list as Spec[]) {
    if (usable(spec, endpoint) && spec.showInMenu !== false && spec.name && spec.preset?.model) {
      models.push({
        id: spec.name,
        label: spec.label || spec.name,
        ...(spec.group ? { group: spec.group } : {}),
        model: spec.preset.model,
      });
    }
  }
  return models;
}

/** The picked spec, or null when it is not on this user's list. */
export function findWizardModel(
  req: ServerRequest,
  config: Pick<TClipToolsConfig, 'wizard'>,
  modelId: string,
): WizardModel | null {
  return listWizardModels(req, config).find((model) => model.id === modelId) ?? null;
}

export function publicModels(models: readonly WizardModel[]): TClipWizardModel[] {
  return models.map(({ id, label, group }) => ({ id, label, ...(group ? { group } : {}) }));
}
