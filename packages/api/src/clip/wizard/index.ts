import type { ClipWizardDeps } from './types';
import type { ServerRequest } from '~/types';
import { validateWizardStoryboard } from './validate';
import { createVoiceSampler } from './sample';
import { startWizardRender } from './render';
import { getWizardConfig } from './config';

export type { ClipWizardDeps, WizardReply, WizardErrorBody } from './types';

/** The clip wizard's endpoint handlers, bound to the host's storage, jobs and billing. */
export function createClipWizard(deps: ClipWizardDeps) {
  const sample = createVoiceSampler();
  return {
    config: (req: ServerRequest) => getWizardConfig(req, deps),
    validate: (req: ServerRequest) => validateWizardStoryboard(req, deps),
    voiceSample: (req: ServerRequest) => sample(req, deps),
    render: (req: ServerRequest) => startWizardRender(req, deps),
  };
}

export type ClipWizard = ReturnType<typeof createClipWizard>;
