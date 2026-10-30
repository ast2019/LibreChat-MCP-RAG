import type { Document, Types } from 'mongoose';

export type MediaJobProvider = 'openrouter' | 'higgsfield';
export type MediaJobStatus = 'pending' | 'completed' | 'failed';

export interface IMediaJob extends Document {
  user: Types.ObjectId;
  kind: 'video';
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
export interface MediaJobRecord {
  id: string;
  user: string;
  kind: 'video';
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

export type MediaJobUpdate = Partial<
  Pick<
    MediaJobRecord,
    'status' | 'errorCode' | 'file_id' | 'filepath' | 'type' | 'chargedCredits' | 'nextPollAt'
  >
>;
