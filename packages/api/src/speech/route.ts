import type { TModelSpec } from 'librechat-data-provider';
import type { SpeechRoute } from './types';
import { resolveUploadOcrRoute } from '~/files/hiveOcr/route';

/** What a speech request names about its conversation. */
export interface SpeechRouteFields {
  conversationId?: string;
  endpoint?: string;
  spec?: string;
}

/** The stored conversation fields that decide a speech route. */
export interface SpeechConversationRecord {
  endpoint?: string | null;
  spec?: string | null;
}

export interface ResolveSpeechRouteParams {
  requested: SpeechRouteFields;
  stored?: SpeechConversationRecord | null;
  specs?: ReadonlyArray<Partial<Pick<TModelSpec, 'name' | 'privacy'>>> | null;
  localEndpoints: readonly string[];
  privateEndpoints: readonly string[];
}

/**
 * Route of a speech request, decided exactly like a document upload's OCR route: the stored
 * conversation decides and the request can only make it stricter, so a private chat never gets
 * public speech and audio of a local chat never leaves the device.
 */
export function resolveSpeechRoute({
  requested,
  stored,
  specs,
  localEndpoints,
  privateEndpoints,
}: ResolveSpeechRouteParams): SpeechRoute {
  return resolveUploadOcrRoute({
    requested: { endpoint: requested.endpoint, spec: requested.spec },
    stored,
    specs,
    localEndpoints,
    privateEndpoints,
  });
}
