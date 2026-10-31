import { z } from 'zod';
import type { ZodTypeAny } from 'zod';
import type { EndpointContract, RawContent } from './adapter';
import { genericServerErrorContent, messageResponseSchema } from './errors';

/**
 * The model-calling API a user reaches with an API key from Settings → API keys: the
 * OpenAI-compatible Chat Completions and model list, the Open Responses endpoint and the
 * agent event ingress. Schemas describe the wire shapes the controllers accept and send; the
 * runtime validators live in `agents/openai/service.ts`, `agents/responses/service.ts` and
 * `agents/triggers`.
 */
const SECURITY = ['apiKey'];
const MODELS = 'Models';
const CHAT = 'Chat Completions';
const RESPONSES = 'Responses';
const EVENTS = 'Events';

const openAIErrorSchema = z
  .object({
    error: z.object({
      message: z.string(),
      type: z.string(),
      code: z.string().nullable().optional(),
      param: z.string().nullable().optional(),
    }),
  })
  .describe('An OpenAI-shaped error. `code` is stable and safe to branch on.');

const textPartSchema = z.object({ type: z.literal('text'), text: z.string() });
const imagePartSchema = z.object({
  type: z.literal('image_url'),
  image_url: z.object({ url: z.string(), detail: z.enum(['auto', 'low', 'high']).optional() }),
});

const toolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
    arguments: z.string().describe('The arguments as a JSON string'),
  }),
});

const chatMessageSchema = z
  .object({
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    content: z.union([z.string(), z.array(z.union([textPartSchema, imagePartSchema]))]).nullable(),
    name: z.string().optional(),
    tool_calls: z
      .array(toolCallSchema)
      .optional()
      .describe('On an assistant message: the calls the model made in that turn'),
    tool_call_id: z
      .string()
      .optional()
      .describe('On a tool message: the id of the call it answers. Required for role "tool".'),
  })
  .describe(
    'A message. A `tool` message must answer a call of the assistant message before it; a call left unanswered is dropped from the history.',
  );

const functionToolSchema = z.object({
  type: z.literal('function'),
  function: z.object({
    name: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .describe('Unique within the request'),
    description: z.string().nullable().optional(),
    parameters: z
      .record(z.unknown())
      .nullable()
      .optional()
      .describe('A JSON Schema object; omitted means no parameters'),
    strict: z.boolean().nullable().optional(),
  }),
});

const chatCompletionRequestSchema = z.object({
  model: z
    .string()
    .describe(
      'A model id from `GET /models`: a model of the menu (e.g. `smart`) or a shared agent id. Raw provider ids are not accepted.',
    ),
  messages: z.array(chatMessageSchema).min(1),
  stream: z.boolean().optional().describe('Send Server-Sent Events of `chat.completion.chunk`'),
  stream_options: z
    .object({ include_usage: z.boolean().optional() })
    .optional()
    .describe('Accepted for compatibility; the last chunk always carries `usage`'),
  tools: z
    .array(functionToolSchema)
    .max(128)
    .optional()
    .describe(
      'Function tools the caller executes. The model sees only these (its own server tools are off for the request). When it calls them the response ends with `finish_reason: "tool_calls"`; send the results back as `role: "tool"` messages.',
    ),
  tool_choice: z
    .union([
      z.enum(['none', 'auto', 'required']),
      z.object({ type: z.literal('function'), function: z.object({ name: z.string() }) }),
    ])
    .optional()
    .describe(
      '`none` binds no tools. `auto` (default), `required` and a named function bind all of them; the last two are asked of the model, which providers may not enforce.',
    ),
  max_tokens: z.number().int().positive().optional(),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  frequency_penalty: z.number().optional(),
  presence_penalty: z.number().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  user: z.string().optional(),
  conversation_id: z
    .string()
    .optional()
    .describe('Extension: continue a stored conversation instead of sending the whole history'),
  parent_message_id: z.string().optional().describe('Extension: the message to continue from'),
});

const usageSchema = z.object({
  prompt_tokens: z.number().int(),
  completion_tokens: z.number().int(),
  total_tokens: z.number().int(),
});

const chatCompletionSchema = z.object({
  id: z.string(),
  object: z.literal('chat.completion'),
  created: z.number().int(),
  model: z.string(),
  choices: z.array(
    z.object({
      index: z.number().int(),
      message: z.object({
        role: z.literal('assistant'),
        content: z.string().nullable(),
        reasoning: z
          .string()
          .optional()
          .describe('Extension: the model reasoning, when it has any'),
        tool_calls: z.array(toolCallSchema).optional(),
      }),
      finish_reason: z.enum(['stop', 'length', 'tool_calls', 'content_filter']).nullable(),
    }),
  ),
  usage: usageSchema,
});

const chatCompletionChunkContent: RawContent = {
  'text/event-stream': {
    schema: {
      type: 'string',
      description:
        'Server-Sent Events, one `data: {chat.completion.chunk}` per line pair and a final `data: [DONE]`. The first chunk carries `delta.role`, text arrives in `delta.content`, reasoning in `delta.reasoning`, and caller tool calls in `delta.tool_calls` (by `index`, with `id`, `type`, `function.name`, then `function.arguments`). The last chunk carries `finish_reason` and `usage`. An error after streaming started arrives as a final content chunk followed by `[DONE]`.',
    },
  },
};

const modelSchema = z.object({
  id: z.string().describe('The value to send as `model`'),
  object: z.literal('model'),
  created: z.number().int(),
  owned_by: z.string(),
  permission: z.array(z.unknown()),
  root: z.string(),
  parent: z.null(),
  name: z.string().optional().describe('Extension: the name the menu shows'),
  description: z.string().optional(),
  provider: z.string().optional().describe('Extension: the brand group, e.g. `Claude`'),
  privacy: z
    .enum(['local', 'private'])
    .optional()
    .describe(
      'Extension: `local` runs on the deployment own servers; `private` uses providers that keep no data',
    ),
});

const modelListSchema = z.object({ object: z.literal('list'), data: z.array(modelSchema) });

const responseRequestSchema = z
  .object({
    model: z.string().describe('A model id from `GET /models`'),
    input: z
      .union([z.string(), z.array(z.record(z.unknown()))])
      .describe(
        'A string, or Open Responses input items (`message`, `function_call`, `function_call_output`)',
      ),
    instructions: z.string().optional(),
    tools: z
      .array(z.record(z.unknown()))
      .optional()
      .describe(
        'Function tools `{type: "function", name, description, parameters}` the caller executes; a call returns as a `function_call` output item',
      ),
    tool_choice: z.unknown().optional(),
    stream: z.boolean().optional(),
    previous_response_id: z
      .string()
      .optional()
      .describe('Continue a response stored with `store: true`'),
    store: z.boolean().optional(),
    max_output_tokens: z.number().int().positive().optional(),
    temperature: z.number().optional(),
    top_p: z.number().optional(),
    reasoning: z.record(z.unknown()).optional(),
    metadata: z.record(z.string()).optional(),
  })
  .passthrough();

const responseSchema = z
  .object({
    id: z.string(),
    object: z.literal('response'),
    created_at: z.number().int(),
    status: z.string(),
    model: z.string(),
    output: z.array(z.record(z.unknown())),
    usage: z.record(z.unknown()).optional(),
  })
  .passthrough();

const responseStreamContent: RawContent = {
  'text/event-stream': {
    schema: {
      type: 'string',
      description:
        'Open Responses streaming events (`response.created`, `response.output_text.delta`, `response.function_call_arguments.delta`, `response.completed`, …).',
    },
  },
};

const eventRequestSchema = z
  .object({
    mode: z.enum(['fire', 'continue', 'steer']),
    event: z.object({
      id: z.string(),
      type: z.string(),
      occurredAt: z.number().int().describe('Epoch milliseconds'),
      payload: z.record(z.unknown()).optional(),
    }),
    target: z.object({ agentId: z.string() }).optional(),
    bindingId: z.string().optional(),
    input: z.string().optional(),
    orderingKey: z.string().optional(),
    expectedAction: z.record(z.unknown()).optional(),
  })
  .passthrough();

const eventBindingRequestSchema = z.object({
  actorId: z.string(),
  parentConversationId: z.string(),
  parentMessageId: z.string(),
  target: z.object({ agentId: z.string() }),
});

const deliverySchema = z.object({ id: z.string() }).passthrough();

const idempotencyHeader =
  'Send exactly one `Idempotency-Key` header and keep it stable when retrying the same delivery.';

/** Every model call shares these refusals, in the order the server checks them. */
const callErrors = [
  { status: 400, description: 'Invalid request', schema: openAIErrorSchema },
  {
    status: 401,
    description: '`missing_api_key` (send `Authorization: Bearer <key>`) or `invalid_api_key`',
    schema: openAIErrorSchema,
  },
  {
    status: 402,
    description: '`insufficient_balance`: no credit left',
    schema: openAIErrorSchema,
  },
  {
    status: 403,
    description:
      '`api_access_disabled` (switched off for this account), `api_not_in_pack` (the current pack excludes the API), the role has no API access, or `access_denied` for an agent not shared with the caller',
    schema: z.union([openAIErrorSchema, messageResponseSchema]),
  },
  { status: 404, description: '`model_not_found`', schema: openAIErrorSchema },
  {
    status: 409,
    description: '`account_deletion_in_progress`',
    schema: openAIErrorSchema,
  },
  {
    status: 429,
    description:
      '`rate_limit_exceeded`: too many calls for this user in the window (`rateLimits.api`). Wait for `Retry-After` seconds.',
    schema: openAIErrorSchema,
  },
  {
    status: 500,
    description: 'Internal server error',
    schema: openAIErrorSchema,
    additionalContent: genericServerErrorContent,
  },
];

export const inferenceComponentSchemas: Record<string, ZodTypeAny> = {
  OpenAIError: openAIErrorSchema,
  ChatMessage: chatMessageSchema,
  FunctionTool: functionToolSchema,
  ChatCompletionRequest: chatCompletionRequestSchema,
  ChatCompletion: chatCompletionSchema,
  Model: modelSchema,
  ModelList: modelListSchema,
  ResponseRequest: responseRequestSchema,
  Response: responseSchema,
  AgentEventRequest: eventRequestSchema,
  AgentEventBindingRequest: eventBindingRequestSchema,
};

export const inferenceContracts: EndpointContract[] = [
  {
    operationId: 'listModels',
    method: 'get',
    path: '/models',
    tags: [MODELS],
    summary: 'List the models this key can call',
    description:
      'The models of the menu this user may use (including local and private ones they have access to), then the agents shared with them. Use `id` as `model`.',
    security: SECURITY,
    responses: [{ status: 200, description: 'The models', schema: modelListSchema }, ...callErrors],
  },
  {
    operationId: 'getModel',
    method: 'get',
    path: '/models/{model}',
    tags: [MODELS],
    summary: 'Read one model',
    security: SECURITY,
    pathParams: [{ name: 'model', description: 'A model id from `GET /models`' }],
    responses: [{ status: 200, description: 'The model', schema: modelSchema }, ...callErrors],
  },
  {
    operationId: 'createChatCompletion',
    method: 'post',
    path: '/chat/completions',
    tags: [CHAT],
    summary: 'Create a chat completion (OpenAI-compatible)',
    description:
      'Works with OpenAI SDKs and coding clients by setting the base URL and key. Image, video and voice generation are not available here. Usage is charged to the account like chat.',
    security: SECURITY,
    body: chatCompletionRequestSchema,
    responses: [
      {
        status: 200,
        description: 'The completion, or a stream of chunks when `stream` is true',
        schema: chatCompletionSchema,
        additionalContent: chatCompletionChunkContent,
      },
      ...callErrors,
    ],
  },
  {
    operationId: 'createResponse',
    method: 'post',
    path: '/responses',
    tags: [RESPONSES],
    summary: 'Create a response (Open Responses)',
    security: SECURITY,
    body: responseRequestSchema,
    responses: [
      {
        status: 200,
        description: 'The response, or a stream of events when `stream` is true',
        schema: responseSchema,
        additionalContent: responseStreamContent,
      },
      ...callErrors,
    ],
  },
  {
    operationId: 'listResponseModels',
    method: 'get',
    path: '/responses/models',
    tags: [RESPONSES],
    summary: 'List the models, as `GET /models` does',
    security: SECURITY,
    responses: [{ status: 200, description: 'The models', schema: modelListSchema }, ...callErrors],
  },
  {
    operationId: 'getResponse',
    method: 'get',
    path: '/responses/{id}',
    tags: [RESPONSES],
    summary: 'Read a stored response',
    security: SECURITY,
    pathParams: [{ name: 'id', description: 'A response id created with `store: true`' }],
    responses: [
      { status: 200, description: 'The response', schema: responseSchema },
      ...callErrors,
    ],
  },
  {
    operationId: 'createAgentEvent',
    method: 'post',
    path: '/events',
    tags: [EVENTS],
    summary: 'Deliver an event to an agent',
    description: `Durably queues an event for a shared agent (\`fire\`), a bound child actor (\`continue\`) or a running generation (\`steer\`). ${idempotencyHeader}`,
    security: SECURITY,
    body: eventRequestSchema,
    responses: [
      { status: 202, description: 'Accepted; poll `GET /events/{id}`', schema: deliverySchema },
      ...callErrors,
    ],
  },
  {
    operationId: 'createAgentEventBinding',
    method: 'post',
    path: '/events/bindings',
    tags: [EVENTS],
    summary: 'Bind a source actor to a child agent thread',
    description: idempotencyHeader,
    security: SECURITY,
    body: eventBindingRequestSchema,
    responses: [
      { status: 200, description: 'The binding id and child thread', schema: deliverySchema },
      ...callErrors,
    ],
  },
  {
    operationId: 'getAgentEvent',
    method: 'get',
    path: '/events/{id}',
    tags: [EVENTS],
    summary: 'Read an event delivery status',
    security: SECURITY,
    pathParams: [{ name: 'id', description: 'The delivery id `POST /events` returned' }],
    responses: [
      {
        status: 200,
        description: 'The delivery state (`pending`, `leased`, `succeeded`, `dead`) and handling',
        schema: deliverySchema,
      },
      ...callErrors,
    ],
  },
];
