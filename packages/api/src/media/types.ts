import type { SpeechEndpoint } from '~/speech/types';

export type MediaFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The fields of the signed-in user the media tools read; already loaded by authentication. */
export interface MediaUser {
  id: string;
  role?: string;
  tenantId?: string;
  mediaAccess?: boolean | null;
}

export interface MediaEndpoint extends SpeechEndpoint {
  /** Custom endpoint name, recorded on the ledger */
  name: string;
}

/** A generated file saved for the user; `filepath` is where the client loads it. */
export interface SavedMedia {
  file_id: string;
  filepath: string;
  filename: string;
  type: string;
  bytes: number;
}

/** A failure the tool reports to the model by stable code, never by provider text. */
export class MediaError extends Error {
  constructor(
    public readonly code:
      | 'provider_error'
      | 'timeout'
      | 'aborted'
      | 'blocked'
      | 'no_output'
      | 'too_large',
    message: string,
  ) {
    super(message);
    this.name = 'MediaError';
  }
}
