import type { Document, Types } from 'mongoose';

export type MediaJobProvider = 'openrouter' | 'higgsfield' | 'remotion';
export type MediaJobStatus = 'pending' | 'completed' | 'failed';
/** `video`: a provider generation; `clip`: a storyboard render on the HiveGPT Remotion worker */
export type MediaJobKind = 'video' | 'clip';

/** Fields only clip jobs carry. */
interface ClipJobFields {
  /** 0..1, as the worker reports it */
  progress?: number;
  /** Worker stage: queued, assets, tts, bundle, render, encode, ... */
  stage?: string;
  /** The validated clip request (storyboard and image references, never file bytes) */
  payload?: Record<string, unknown>;
  /** The worker's job id once the render was submitted */
  workerJobId?: string;
  /** The owner asked to stop; the next worker step cancels the render */
  cancelRequested?: boolean;
  /** Non-fatal worker notes (unknown icon names, a trimmed upload, a failed narration) */
  warnings?: string[];
}

export interface IMediaJob extends Document, ClipJobFields {
  user: Types.ObjectId;
  kind: MediaJobKind;
  provider: MediaJobProvider;
  /** The provider's job id (OpenRouter video job, Higgsfield request id) */
  providerJobId: string;
  providerModel: string;
  label?: string;
  endpoint: string;
  /** Ledger context the finished job is charged under */
  context: string;
  conversationId?: string;
  status: MediaJobStatus;
  errorCode?: string;
  /** Charged when the provider reports no cost (Higgsfield list price, or the hold estimate) */
  fallbackUsd: number;
  priceMultiplier: number;
  file_id?: string;
  filepath?: string;
  type?: string;
  chargedCredits?: number;
  pollIntervalMs: number;
  nextPollAt: Date;
  leaseUntil?: Date | null;
  /** Past this the job is given up as `timeout` and nothing is charged */
  deadline: Date;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/** A media job as plain data with a string id. */
export interface MediaJobRecord extends ClipJobFields {
  id: string;
  user: string;
  kind: MediaJobKind;
  provider: MediaJobProvider;
  providerJobId: string;
  providerModel: string;
  label?: string;
  endpoint: string;
  context: string;
  conversationId?: string;
  status: MediaJobStatus;
  errorCode?: string;
  fallbackUsd: number;
  priceMultiplier: number;
  file_id?: string;
  filepath?: string;
  type?: string;
  chargedCredits?: number;
  pollIntervalMs: number;
  nextPollAt: Date;
  deadline: Date;
  tenantId?: string;
  createdAt?: Date;
}

export type MediaJobCreateData = Omit<
  MediaJobRecord,
  'id' | 'status' | 'nextPollAt' | 'createdAt' | 'file_id' | 'filepath' | 'type' | 'chargedCredits'
> & { nextPollAt?: Date };

/** `payload: null` removes the stored payload (a finished clip keeps no storyboard). */
export type MediaJobUpdate = Partial<
  Pick<
    MediaJobRecord,
    | 'status'
    | 'errorCode'
    | 'file_id'
    | 'filepath'
    | 'type'
    | 'chargedCredits'
    | 'nextPollAt'
    | 'progress'
    | 'stage'
    | 'workerJobId'
    | 'warnings'
  >
> & { payload?: Record<string, unknown> | null };
