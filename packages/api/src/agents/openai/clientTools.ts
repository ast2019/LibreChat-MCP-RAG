/**
 * Caller-executed tools for `POST /v1/chat/completions`, the way coding clients (VS Code
 * extensions such as Continue, Cline and Roo Code, OpenCode, Aider, Codex CLI) use them:
 *
 *   { "model": "...", "messages": [...],
 *     "tools": [{ "type": "function",
 *                 "function": { "name": "read_file", "parameters": { ... } } }] }
 *
 * The model sees only the caller's tools. When it calls them, the run ends and the calls come
 * back as `message.tool_calls` (streamed as `delta.tool_calls`) with `finish_reason:
 * "tool_calls"`. The caller runs them and continues by sending the assistant message with its
 * `tool_calls` and one `role: "tool"` message per call. Nothing is held on the server between
 * the two requests.
 *
 * The SDK's client delegation (`clientDelegatedToolNames`) ends the graph on such a turn and
 * marks the calls `client`, which is what the accepted-result projector publishes. It needs a
 * single-agent graph and refuses a turn that mixes client and server tools, so a request with
 * tools runs the model without its server tools.
 */
import { ContentTypes } from 'librechat-data-provider';
import type { LCTool } from '@librechat/agents';
import type { ChatFunctionTool, ChatMessage, ChatToolChoice } from './types';

export type { ChatFunctionTool, ChatToolChoice } from './types';

/** JSON Schema stand-in for a tool that declares no parameters. */
const EMPTY_PARAMETERS = { type: 'object', properties: {} } as const;

/** The character set OpenAI accepts for function names. */
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Most tools one request may declare. */
export const MAX_CHAT_TOOLS = 128;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value);

/** Why `tools` cannot be used, or undefined when it can (or is absent). */
export function validateChatTools(tools: unknown): string | undefined {
  if (tools === undefined || tools === null) {
    return undefined;
  }
  if (!Array.isArray(tools)) {
    return 'tools must be an array';
  }
  if (tools.length > MAX_CHAT_TOOLS) {
    return `tools may list at most ${MAX_CHAT_TOOLS} entries`;
  }
  const names = new Set<string>();
  for (let i = 0; i < tools.length; i++) {
    const tool: unknown = tools[i];
    if (!isRecord(tool) || tool.type !== 'function') {
      return `tools[${i}].type must be "function"`;
    }
    const fn = tool.function;
    if (!isRecord(fn)) {
      return `tools[${i}].function must be an object`;
    }
    if (typeof fn.name !== 'string' || !TOOL_NAME_PATTERN.test(fn.name)) {
      return `tools[${i}].function.name must be 1-64 letters, digits, "_" or "-"`;
    }
    if (names.has(fn.name)) {
      return `tools[${i}].function.name "${fn.name}" is declared twice`;
    }
    names.add(fn.name);
    if (fn.description != null && typeof fn.description !== 'string') {
      return `tools[${i}].function.description must be a string`;
    }
    if (fn.parameters != null && !isRecord(fn.parameters)) {
      return `tools[${i}].function.parameters must be a JSON Schema object`;
    }
    if (fn.strict != null && typeof fn.strict !== 'boolean') {
      return `tools[${i}].function.strict must be a boolean`;
    }
  }
  return undefined;
}

/** Why `tool_choice` cannot be used, or undefined when it can (or is absent). */
export function validateChatToolChoice(toolChoice: unknown, tools: unknown): string | undefined {
  if (toolChoice === undefined || toolChoice === null) {
    return undefined;
  }
  if (toolChoice === 'none' || toolChoice === 'auto' || toolChoice === 'required') {
    return undefined;
  }
  if (
    isRecord(toolChoice) &&
    toolChoice.type === 'function' &&
    isRecord(toolChoice.function) &&
    typeof toolChoice.function.name === 'string'
  ) {
    const name = toolChoice.function.name;
    const declared =
      Array.isArray(tools) &&
      tools.some(
        (tool) => isRecord(tool) && isRecord(tool.function) && tool.function.name === name,
      );
    return declared ? undefined : `tool_choice names "${name}", which is not in tools`;
  }
  return 'tool_choice must be "none", "auto", "required" or {"type":"function","function":{"name":...}}';
}

/**
 * The caller's tools this request binds: none for `tool_choice: "none"`, else every declared
 * function tool. `required` and a named function are honored by the tool description and the
 * model; providers differ in whether they can force a call, so neither is guaranteed.
 */
export function selectChatTools(
  tools: ChatFunctionTool[] | undefined,
  toolChoice: ChatToolChoice | undefined,
): ChatFunctionTool[] {
  if (!tools?.length || toolChoice === 'none') {
    return [];
  }
  return tools;
}

/** The tools as the run binds them: schema-only definitions the server never executes. */
export function buildChatToolDefinitions(
  tools: ChatFunctionTool[],
  toolChoice?: ChatToolChoice,
): LCTool[] {
  const forced =
    typeof toolChoice === 'object' && toolChoice != null ? toolChoice.function.name : undefined;
  return tools.map(({ function: fn }) => {
    const notes = [
      fn.description ?? '',
      toolChoice === 'required' ? 'Call a tool in this turn.' : '',
      forced === fn.name ? 'Call this tool in this turn.' : '',
    ].filter(Boolean);
    return {
      name: fn.name,
      ...(notes.length > 0 && { description: notes.join(' ') }),
      parameters: (fn.parameters ?? EMPTY_PARAMETERS) as LCTool['parameters'],
      allowed_callers: ['direct' as const],
    };
  });
}

/** The agent fields a request with tools replaces. */
export interface ChatToolAgent {
  toolDefinitions?: LCTool[];
  tools?: unknown[];
  backgroundToolNames?: string[];
}

/**
 * Binds the caller's tools to the run's only agent, in place of its server tools. Returns the
 * names to hand to `createRun` as `clientDelegatedToolNames`, or an error when the model runs
 * as several agents (client delegation needs a single-agent graph).
 */
export function applyChatClientTools({
  agent,
  agentCount,
  hasSubagents,
  tools,
  toolChoice,
}: {
  agent: ChatToolAgent;
  agentCount: number;
  hasSubagents: boolean;
  tools: ChatFunctionTool[] | undefined;
  toolChoice: ChatToolChoice | undefined;
}): { ok: true; names: string[] } | { ok: false; error: string } {
  const selected = selectChatTools(tools, toolChoice);
  if (selected.length === 0) {
    return { ok: true, names: [] };
  }
  if (agentCount > 1 || hasSubagents) {
    return {
      ok: false,
      error:
        'This model runs as several agents and cannot take caller tools; choose a single model from GET /v1/models',
    };
  }
  agent.toolDefinitions = buildChatToolDefinitions(selected, toolChoice);
  agent.tools = [];
  agent.backgroundToolNames = [];
  return { ok: true, names: selected.map((tool) => tool.function.name) };
}

/** One assistant turn's tool call with its result, as the formatter reads it. */
export interface ChatToolCallPart {
  type: ContentTypes.TOOL_CALL;
  tool_call: { id: string; name: string; args: string; output: string };
}

export interface ChatInternalMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; image_url?: unknown } | ChatToolCallPart>;
  name?: string;
}

function textOf(content: ChatMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((part) => (part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n');
}

function convertContent(content: ChatMessage['content']): ChatInternalMessage['content'] {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content.map((part) => {
    if (part.type === 'text') {
      return { type: 'text', text: part.text };
    }
    if (part.type === 'image_url') {
      return { type: 'image_url', image_url: part.image_url };
    }
    return part as { type: string };
  });
}

/**
 * Why the history's tool exchanges cannot be replayed, or undefined when they can: every
 * `role: "tool"` message answers, once, a call of the assistant message before it, and every
 * call names its id and function. A call left unanswered is dropped from the replay, as the
 * Responses endpoint does, rather than refused.
 */
export function validateChatToolExchanges(messages: ChatMessage[]): string | undefined {
  let open = new Set<string>();
  const answered = new Set<string>();
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role === 'tool') {
      const id = message.tool_call_id;
      if (typeof id !== 'string' || id === '') {
        return `messages[${i}].tool_call_id is required for a tool message`;
      }
      if (!open.has(id) || answered.has(id)) {
        return `messages[${i}] answers tool call "${id}", which the assistant message before it did not make or was already answered`;
      }
      answered.add(id);
      continue;
    }
    open = new Set();
    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) {
        if (typeof call?.id !== 'string' || call.id === '') {
          return `messages[${i}].tool_calls entries need an id`;
        }
        if (typeof call.function?.name !== 'string' || call.function.name === '') {
          return `messages[${i}].tool_calls entries need function.name`;
        }
        open.add(call.id);
      }
    }
  }
  return undefined;
}

/**
 * Chat Completions messages as the formatter reads them. An assistant message with
 * `tool_calls` and the `role: "tool"` messages that answer it become one assistant message:
 * its text, then one `tool_call` part per call carrying its result. The formatter turns that
 * into the AI message and tool messages providers expect; a bare `tool` role would format as a
 * system message instead. A call with no result is left out. Call
 * {@link validateChatToolExchanges} first.
 */
export function convertChatMessages(messages: ChatMessage[]): ChatInternalMessage[] {
  const results = new Map<string, string>();
  for (const message of messages) {
    if (message.role === 'tool' && typeof message.tool_call_id === 'string') {
      results.set(message.tool_call_id, textOf(message.content));
    }
  }
  const converted: ChatInternalMessage[] = [];
  for (const message of messages) {
    if (message.role === 'tool') {
      continue;
    }
    if (message.role === 'assistant' && message.tool_calls?.length) {
      const text = textOf(message.content);
      const parts = message.tool_calls
        .filter((call) => results.has(call.id))
        .map(
          (call): ChatToolCallPart => ({
            type: ContentTypes.TOOL_CALL,
            tool_call: {
              id: call.id,
              name: call.function.name,
              args: call.function.arguments ?? '{}',
              output: results.get(call.id) ?? '',
            },
          }),
        );
      if (parts.length > 0 || text) {
        converted.push({
          role: 'assistant',
          content: [...(text ? [{ type: ContentTypes.TEXT, text }] : []), ...parts],
        });
      }
      continue;
    }
    converted.push({
      role: message.role as ChatInternalMessage['role'],
      content: convertContent(message.content),
      ...(message.name && { name: message.name }),
    });
  }
  return converted;
}
