import type { ZodTypeAny } from 'zod';
import type { EndpointContract, SecurityScheme } from './adapter';
import {
  errorMessageResponseSchema,
  accountDeletionResponseSchema,
  messageResponseSchema,
  jsonParseErrorSchema,
} from './errors';
import { agentComponentSchemas, agentContracts } from './agents';
import { skillComponentSchemas, skillContracts } from './skills';
import { inferenceComponentSchemas, inferenceContracts } from './inference';

/**
 * Model calls and events authenticate with an API key from Settings → API keys; the agent and
 * skill management endpoints with an OIDC access token. Both are sent as bearer tokens.
 */
export const securitySchemes: Record<string, SecurityScheme> = {
  apiKey: {
    type: 'http',
    scheme: 'bearer',
    description:
      'An API key created in Settings → API keys, sent as `Authorization: Bearer <key>`. The account needs API access (admin switch, pack or role) and credit.',
  },
  oidcBearer: {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: 'An OIDC access token, sent as a bearer token.',
  },
};

export const componentSchemas: Record<string, ZodTypeAny> = {
  ...inferenceComponentSchemas,
  ...agentComponentSchemas,
  ...skillComponentSchemas,
  ErrorMessage: errorMessageResponseSchema,
  AccountDeletionConflict: accountDeletionResponseSchema,
  MessageError: messageResponseSchema,
  JsonParseError: jsonParseErrorSchema,
};

/**
 * Constraints the Zod-to-OpenAPI converter cannot emit, applied to the generated component.
 * `SkillUpdateRequest`'s object-level `.refine()` (at least one update field) is lost in
 * conversion; `minProperties: 2` keeps `expectedVersion` plus at least one real field.
 *
 * `SkillFileUpdateRequest.content` uses `maxLength`, which counts characters, but `updateFile`
 * (skills/management.ts) rejects when the UTF-8 buffer exceeds 1 MiB. The converter drops the
 * field description, so restate the single `content` property here with the byte limit. The
 * component has only this property, so the whole `properties` object is stated, not clobbered.
 */
export const componentSchemaOverrides: Record<string, Record<string, unknown>> = {
  SkillUpdateRequest: { minProperties: 2 },
  SkillFileUpdateRequest: {
    properties: {
      content: {
        type: 'string',
        maxLength: 1024 * 1024,
        description:
          'The file content. The accepted maximum is 1 MiB (1,048,576 bytes) of UTF-8-encoded content. The limit is measured in bytes, not characters, so non-ASCII content reaches it at fewer characters.',
      },
    },
  },
};

export const contracts: EndpointContract[] = [
  ...inferenceContracts,
  ...agentContracts,
  ...skillContracts,
];
