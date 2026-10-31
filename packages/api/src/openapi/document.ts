import { securitySchemes, componentSchemas, componentSchemaOverrides, contracts } from './registry';
import { buildOpenApiDocument } from './adapter';

/** Stable document version, independent of the package version, so the artifact does not churn. */
const DOCUMENT_VERSION = '0.1.0';

/** Build the OpenAPI 3.1 document for the public model, event, agent and skill endpoints. */
export function buildAgentsOpenApiDocument(): Record<string, unknown> {
  return buildOpenApiDocument({
    info: {
      title: 'Agents API',
      version: DOCUMENT_VERSION,
      description:
        'Call the models with an API key: OpenAI-compatible `/models` and `/chat/completions` (with caller-executed tools, for coding clients), Open Responses `/responses`, and agent events. The agent and skill management endpoints use an OIDC token. Base URL: `<site>/api/agents/v1`.',
    },
    servers: [
      {
        url: 'agents/v1',
        description:
          'Relative to where this document is served (`/api/openapi.json`), so it resolves under any deployment base path.',
      },
    ],
    securitySchemes,
    componentSchemas,
    componentSchemaOverrides,
    contracts,
  });
}
