import { response } from 'express';
import { Run, Providers, formatAgentMessages } from '@librechat/agents';
import { AIMessageChunk } from '@librechat/agents/langchain/messages';
import type { BaseMessage } from '@langchain/core/messages';
import type { Response } from 'express';
import type { ChatCompletionChunk, ChatMessage } from './types';
import type { ChatFunctionTool } from './clientTools';
import {
  sendFinalChunk,
  createOpenAIHandlers,
  createOpenAIStreamTracker,
  createOpenAIContentAggregator,
} from './handlers';
import {
  applyChatClientTools,
  convertChatMessages,
  validateChatToolExchanges,
} from './clientTools';
import { buildNonStreamingResponse } from './service';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

/**
 * A coding client's tool round trip through a real SDK run, as the Chat Completions host
 * wires it: the caller's tools replace the agent's, `clientDelegatedToolNames` ends the run on
 * their call, the accepted-result projector publishes it, and the replayed history reaches the
 * model as an AI message with its tool results. Only the provider transport is replaced.
 */
const readFile: ChatFunctionTool = {
  type: 'function',
  function: {
    name: 'read_file',
    description: 'Read a file of the workspace',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
};

function captureRes() {
  const frames: string[] = [];
  const res: Response = Object.create(response);
  jest.spyOn(res, 'write').mockImplementation((frame) => {
    frames.push(String(frame));
    return true;
  });
  const chunks = () =>
    frames
      .filter((frame) => frame !== 'data: [DONE]\n\n')
      .map((frame) => JSON.parse(frame.slice(6)) as ChatCompletionChunk);
  return { res, frames, chunks };
}

async function runTurn({
  messages,
  streaming,
  answer,
}: {
  messages: ChatMessage[];
  streaming: boolean;
  answer: (seen: BaseMessage[]) => AIMessageChunk;
}) {
  const agent: { toolDefinitions?: unknown[]; tools?: unknown[]; backgroundToolNames?: string[] } =
    { toolDefinitions: [{ name: 'web_search', parameters: { type: 'object' } }], tools: [] };
  const applied = applyChatClientTools({
    agent: agent as Parameters<typeof applyChatClientTools>[0]['agent'],
    agentCount: 1,
    hasSubagents: false,
    tools: [readFile],
    toolChoice: 'auto',
  });
  if (!applied.ok) throw new Error(applied.error);

  const { res, chunks } = captureRes();
  const context = { requestId: 'chatcmpl-test', created: 1, model: 'smart' };
  const tracker = createOpenAIStreamTracker();
  const aggregator = createOpenAIContentAggregator();
  const config = streaming ? { tracker, res, context } : { aggregator };
  const handlers = createOpenAIHandlers(config);

  expect(validateChatToolExchanges(messages)).toBeUndefined();
  const toolSet = new Set(applied.names);
  const { messages: formatted } = formatAgentMessages(
    convertChatMessages(messages) as Parameters<typeof formatAgentMessages>[0],
    {},
    toolSet,
  );

  const run = await Run.create({
    runId: 'chatcmpl-test',
    tokenCounter: () => 1,
    graphConfig: {
      type: 'standard',
      agents: [
        {
          agentId: 'agent',
          provider: Providers.OPENAI,
          clientOptions: { model: 'gpt-test', streaming: false },
          toolDefinitions: agent.toolDefinitions as never,
        },
      ],
    },
    customHandlers: handlers as never,
    clientDelegatedToolNames: applied.names,
  });
  if (run.Graph == null) throw new Error('Missing graph');
  const seen: BaseMessage[][] = [];
  run.Graph.overrideModel = {
    invoke: async (input: BaseMessage[]) => {
      seen.push(input);
      return answer(input);
    },
  } as never;

  await run.processStream(
    { messages: formatted },
    { configurable: { thread_id: 'chatcmpl-test' }, version: 'v2' },
  );
  return { agent, applied, seen, tracker, aggregator, config, context, chunks };
}

const callReadFile = () =>
  new AIMessageChunk({
    content: '',
    tool_calls: [{ id: 'call_1', name: 'read_file', args: { path: 'src/app.ts' } }],
  });

describe('Chat Completions caller tools through a real SDK run', () => {
  it('binds only the caller tools in place of the server tools', async () => {
    const { agent, applied } = await runTurn({
      messages: [{ role: 'user', content: 'open app.ts' }],
      streaming: false,
      answer: callReadFile,
    });
    expect(applied).toEqual({ ok: true, names: ['read_file'] });
    expect(agent.toolDefinitions).toEqual([
      expect.objectContaining({ name: 'read_file', description: 'Read a file of the workspace' }),
    ]);
  });

  it('streams the call as tool_calls and finishes with tool_calls, without running it', async () => {
    const turn = await runTurn({
      messages: [{ role: 'user', content: 'open app.ts' }],
      streaming: true,
      answer: callReadFile,
    });
    turn.tracker.finishToolCalls?.();
    sendFinalChunk(turn.config as Parameters<typeof sendFinalChunk>[0], 'stop', undefined, true);
    const chunks = turn.chunks();
    const parts = chunks.flatMap((chunk) => chunk.choices[0].delta.tool_calls ?? []);
    expect(parts[0]).toMatchObject({
      index: 0,
      id: 'call_1',
      type: 'function',
      function: { name: 'read_file' },
    });
    const args = parts.map((part) => part.function?.arguments ?? '').join('');
    expect(JSON.parse(args)).toEqual({ path: 'src/app.ts' });
    expect(chunks[chunks.length - 1].choices[0].finish_reason).toBe('tool_calls');
    /** The model was asked once: the call ended the run instead of entering a tool node */
    expect(turn.seen).toHaveLength(1);
  });

  it('returns the call in message.tool_calls when not streaming', async () => {
    const turn = await runTurn({
      messages: [{ role: 'user', content: 'open app.ts' }],
      streaming: false,
      answer: callReadFile,
    });
    turn.aggregator.finishToolCalls?.();
    const body = buildNonStreamingResponse(
      turn.context,
      turn.aggregator.getText(),
      turn.aggregator.getReasoning(),
      turn.aggregator.toolCalls,
      { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      true,
    );
    expect(body.choices[0].finish_reason).toBe('tool_calls');
    expect(body.choices[0].message.tool_calls).toEqual([
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'read_file', arguments: JSON.stringify({ path: 'src/app.ts' }) },
      },
    ]);
  });

  it('replays the call and its result to the model on the next turn', async () => {
    const history: ChatMessage[] = [
      { role: 'system', content: 'You are a coding assistant.' },
      { role: 'user', content: 'open app.ts' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"src/app.ts"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'export const answer = 42;' },
    ];
    const turn = await runTurn({
      messages: history,
      streaming: true,
      answer: () => new AIMessageChunk('The file exports answer = 42.'),
    });
    sendFinalChunk(turn.config as Parameters<typeof sendFinalChunk>[0], 'stop', undefined, true);
    const input = turn.seen[0];
    const ai = input.find((message) => message.getType() === 'ai') as AIMessageChunk | undefined;
    expect(ai?.tool_calls?.[0]).toMatchObject({
      id: 'call_1',
      name: 'read_file',
      args: { path: 'src/app.ts' },
    });
    const tool = input.find((message) => message.getType() === 'tool');
    expect(tool?.content).toBe('export const answer = 42;');
    expect(input.some((message) => message.getType() === 'system')).toBe(true);

    const chunks = turn.chunks();
    expect(chunks.map((chunk) => chunk.choices[0].delta.content ?? '').join('')).toBe(
      'The file exports answer = 42.',
    );
    expect(chunks[chunks.length - 1].choices[0].finish_reason).toBe('stop');
  });
});
