/**
 * OpenAI-compatible API for LibreChat agents.
 *
 * This module provides an OpenAI v1/chat/completions compatible interface
 * for interacting with LibreChat agents remotely via API.
 *
 * @example
 * ```typescript
 * import { createAgentChatCompletion, listAgentModels } from '@librechat/api';
 *
 * // POST /v1/chat/completions
 * app.post('/v1/chat/completions', async (req, res) => {
 *   await createAgentChatCompletion(req, res, dependencies);
 * });
 *
 * // GET /v1/models
 * app.get('/v1/models', async (req, res) => {
 *   await listAgentModels(req, res, { getAgents });
 * });
 * ```
 *
 * Request format:
 * ```json
 * {
 *   "model": "smart",
 *   "messages": [
 *     {"role": "user", "content": "Hello!"}
 *   ],
 *   "stream": true
 * }
 * ```
 *
 * The "model" parameter is a model name from /v1/models: a model of the menu or a shared
 * agent's id. Function `tools` are executed by the caller (see `./clientTools`).
 */

export * from './types';
export * from './handlers';
export * from './clientTools';
export {
  createAgentChatCompletion,
  listAgentModels,
  convertMessages,
  validateRequest,
  isChatCompletionValidationFailure,
  createErrorResponse,
  sendErrorResponse,
  buildNonStreamingResponse,
  type ChatCompletionDependencies,
  type ChatCompletionValidationResult,
  type ChatCompletionValidationSuccess,
  type ChatCompletionValidationFailure,
} from './service';
