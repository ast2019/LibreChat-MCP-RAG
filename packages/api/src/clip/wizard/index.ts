import type {
  TClipWizardChatResponse,
  TClipWizardConfigResponse,
  TClipWizardDraftResponse,
  TClipWizardEstimateResponse,
  TClipWizardRenderResponse,
  TClipWizardValidateResponse,
  TClipWizardVoiceSampleResponse,
} from 'librechat-data-provider';
import type { ClipWizardDeps, WizardReply, WizardErrorBody } from './types';
import type { ServerRequest } from '~/types';
import { draftStoryboard, chatStoryboard } from './draft';
import { validateWizardStoryboard } from './validate';
import { estimateStoryboard } from './estimate';
import { createVoiceSampler } from './sample';
import { startWizardRender } from './render';
import { getWizardConfig } from './config';

export type { ClipWizardDeps, WizardReply, WizardErrorBody } from './types';
export { createWizardLlm } from './llm';
export type { WizardLlm, WizardLlmDeps } from './llm';

/** The clip wizard's endpoint handlers, bound to the host's storage, jobs and billing. */
export interface ClipWizard {
  config: (req: ServerRequest) => Promise<WizardReply<TClipWizardConfigResponse | WizardErrorBody>>;
  validate: (
    req: ServerRequest,
  ) => Promise<WizardReply<TClipWizardValidateResponse | WizardErrorBody>>;
  voiceSample: (
    req: ServerRequest,
  ) => Promise<WizardReply<TClipWizardVoiceSampleResponse | WizardErrorBody>>;
  render: (req: ServerRequest) => Promise<WizardReply<TClipWizardRenderResponse | WizardErrorBody>>;
  draft: (req: ServerRequest) => Promise<WizardReply<TClipWizardDraftResponse | WizardErrorBody>>;
  chat: (req: ServerRequest) => Promise<WizardReply<TClipWizardChatResponse | WizardErrorBody>>;
  estimate: (
    req: ServerRequest,
  ) => Promise<WizardReply<TClipWizardEstimateResponse | WizardErrorBody>>;
}

export function createClipWizard(deps: ClipWizardDeps): ClipWizard {
  const sampler = createVoiceSampler();
  return {
    config: async (req: ServerRequest) => {
      const reply = await getWizardConfig(req, deps);
      if (reply.status === 200) {
        /** Not awaited: the samples are made in the background and never fail the request. */
        void sampler.warm(req, deps);
      }
      return reply;
    },
    validate: (req: ServerRequest) => validateWizardStoryboard(req, deps),
    voiceSample: (req: ServerRequest) => sampler.sample(req, deps),
    render: (req: ServerRequest) => startWizardRender(req, deps),
    draft: (req: ServerRequest) => draftStoryboard(req, deps),
    chat: (req: ServerRequest) => chatStoryboard(req, deps),
    estimate: (req: ServerRequest) => estimateStoryboard(req, deps),
  };
}
