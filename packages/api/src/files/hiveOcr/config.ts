import { documentOcrSchema } from 'librechat-data-provider';
import type { TCustomConfig } from 'librechat-data-provider';
import type { DocumentOcrConfig } from './types';

/** Applies schema defaults to the `documentOcr` yaml block (absent block → disabled). */
export function resolveDocumentOcrConfig(raw?: TCustomConfig['documentOcr']): DocumentOcrConfig {
  return documentOcrSchema.parse(raw ?? {});
}
