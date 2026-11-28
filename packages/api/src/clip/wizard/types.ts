import type { TClipWizardErrorCode, TClipWizardIssue } from 'librechat-data-provider';
import type { ClipNarrationService } from '../narration';
import type { WorkerJobRequest } from '../scene';
import type { ClipStartDeps } from '../start';
import type { WorkerStill } from '../client';
import type { WizardLlm } from './llm';

/** What a handler answers: the host sends `body` as JSON with `status`. */
export interface WizardReply<T = unknown> {
  status: number;
  body: T;
}

export type WizardErrorBody = {
  error: { code: TClipWizardErrorCode };
  issues?: TClipWizardIssue[];
};

/** Where voice samples are kept across restarts (a data-schemas collection); memory when absent. */
export interface ClipVoiceSampleStore {
  find: (key: string) => Promise<{ mime: string; base64: string } | null>;
  save: (sample: { key: string; mime: string; base64: string }) => Promise<void>;
}

export interface ClipWizardDeps extends ClipStartDeps {
  /** The sample voice and charging; the wizard needs it for paid voices */
  narration?: ClipNarrationService;
  /** The model calls behind draft and chat; absent when not wired */
  llm?: WizardLlm;
  findBalanceByUser: (userId: string) => Promise<{ packId?: string | null } | null>;
  env?: Record<string, string | undefined>;
  /** The persisted voice sample store; samples live in process memory only when absent */
  voiceSamples?: ClipVoiceSampleStore;
  /** Renders key frames on the render worker (`POST /stills`); the worker client when absent */
  stills?: (input: WorkerJobRequest) => Promise<{ stills: WorkerStill[]; warnings: string[] }>;
  /** Speaks a free (Edge) sample line; the render worker's `/tts-sample` when absent */
  speakEdge?: (input: {
    text: string;
    lang: 'fa' | 'en';
    voice?: string;
  }) => Promise<{ mime: string; base64: string }>;
}

export const STATUS: Record<TClipWizardErrorCode, number> = {
  wizard_disabled: 403,
  not_allowed: 403,
  insufficient_credit: 402,
  provider_failed: 502,
  no_sample: 422,
  invalid_request: 400,
  invalid_storyboard: 422,
  busy: 429,
  unavailable: 503,
  cap_exceeded: 422,
  model_unavailable: 422,
  server_error: 500,
};

export const fail = (
  code: TClipWizardErrorCode,
  issues?: TClipWizardIssue[],
): WizardReply<WizardErrorBody> => ({
  status: STATUS[code],
  body: { error: { code }, ...(issues ? { issues } : {}) },
});
