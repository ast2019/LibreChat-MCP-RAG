import type {
  TClipWizardConfigResponse,
  TClipWizardRenderResponse,
  TClipWizardValidateResponse,
  TClipWizardVoiceSampleResponse,
} from 'librechat-data-provider';
import type { ClipWizardDeps, WizardReply, WizardErrorBody } from './types';
import type { ServerRequest } from '~/types';
import { validateWizardStoryboard } from './validate';
import { createVoiceSampler } from './sample';
import { startWizardRender } from './render';
import { getWizardConfig } from './config';

export type { ClipWizardDeps, WizardReply, WizardErrorBody } from './types';

export interface ClipWizard {
  config: (req: ServerRequest) => Promise<WizardReply<TClipWizardConfigResponse | WizardErrorBody>>;
  validate: (req: ServerRequest) => Promise<WizardReply<TClipWizardValidateResponse | WizardErrorBody>>;
  voiceSample: (
    req: ServerRequest,
  ) => Promise<WizardReply<TClipWizardVoiceSampleResponse | WizardErrorBody>>;
  render: (req: ServerRequest) => Promise<WizardReply<TClipWizardRenderResponse | WizardErrorBody>>;
}

/** The clip wizard's endpoint handlers, bound to the host's storage, jobs and billing. */
export function createClipWizard(deps: ClipWizardDeps): ClipWizard {
  const sample = createVoiceSampler();
  return {
    config: (req: ServerRequest) => getWizardConfig(req, deps),
    validate: (req: ServerRequest) => validateWizardStoryboard(req, deps),
    voiceSample: (req: ServerRequest) => sample(req, deps),
    render: (req: ServerRequest) => startWizardRender(req, deps),
  };
}
