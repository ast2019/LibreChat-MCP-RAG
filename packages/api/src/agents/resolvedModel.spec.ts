import { concat } from '@langchain/core/utils/stream';
import { AIMessageChunk } from '@langchain/core/messages';
import { ChatGenerationChunk } from '@langchain/core/outputs';
import { getChatModelClass, Providers } from '@librechat/agents';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import { getModelEndUsage, getResponseResolvedModel } from './usage';

/**
 * Streams the way `ChatOpenAI`/`ChatOpenRouter` do: the concrete `model` from the response
 * arrives as `generationInfo.model_name` on the finish chunk, and usage on a trailing chunk.
 * LangChain's `stream()` folds `generationInfo` into each message's `response_metadata`, so
 * the concatenated message `on_chat_model_end` carries is what this exercises.
 */
class AliasStreamingModel extends BaseChatModel {
  _llmType(): string {
    return 'alias-streaming';
  }

  async _generate(): Promise<ChatResult> {
    throw new Error('stream only');
  }

  async *_streamResponseChunks(_messages: BaseMessage[]): AsyncGenerator<ChatGenerationChunk> {
    yield new ChatGenerationChunk({
      message: new AIMessageChunk({ content: 'Hel' }),
      text: 'Hel',
      generationInfo: { prompt: 0, completion: 0 },
    });
    yield new ChatGenerationChunk({
      message: new AIMessageChunk({ content: 'lo' }),
      text: 'lo',
      generationInfo: {
        prompt: 0,
        completion: 0,
        finish_reason: 'stop',
        model_name: 'anthropic/claude-sonnet-5.5',
      },
    });
    yield new ChatGenerationChunk({
      message: new AIMessageChunk({
        content: '',
        usage_metadata: { input_tokens: 12, output_tokens: 2, total_tokens: 14 },
      }),
      text: '',
    });
  }
}

describe('resolved model capture from a streamed response', () => {
  it('reaches the model_end output and the turn metadata', async () => {
    const model = new AliasStreamingModel({});
    let final: AIMessageChunk | undefined;
    for await (const chunk of await model.stream('hi')) {
      final = final == null ? chunk : concat(final, chunk);
    }

    const usage = getModelEndUsage(final);
    expect(usage?.resolved_model).toBe('anthropic/claude-sonnet-5.5');
    expect(usage?.output_tokens).toBe(2);

    const turn = getResponseResolvedModel([{ ...usage, model: '~anthropic/claude-sonnet-latest' }]);
    expect(turn).toEqual({
      resolved: 'anthropic/claude-sonnet-5.5',
      requested: '~anthropic/claude-sonnet-latest',
    });
  });
});

/** OpenRouter's SSE for an alias request: every chunk names the concrete model it routed to. */
function openRouterStream(): Response {
  const model = 'anthropic/claude-sonnet-5.5';
  const events = [
    { id: '1', model, choices: [{ index: 0, delta: { role: 'assistant', content: 'Hel' } }] },
    { id: '1', model, choices: [{ index: 0, delta: { content: 'lo' }, finish_reason: 'stop' }] },
    {
      id: '1',
      model,
      choices: [],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    },
  ];
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
  return new Response(`${body}data: [DONE]\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('resolved model capture from the agents ChatOpenRouter', () => {
  it('reports the routed model once on the streamed output', async () => {
    const ChatOpenRouter = await getChatModelClass(Providers.OPENROUTER);
    /** The SDK types the constructor argument as call options; the class takes model fields */
    const fields = {
      model: '~anthropic/claude-sonnet-latest',
      apiKey: 'test-key',
      streaming: true,
      configuration: {
        baseURL: 'http://127.0.0.1:9/api/v1',
        fetch: async () => openRouterStream(),
      },
    } as unknown as ConstructorParameters<typeof ChatOpenRouter>[0];
    const model = new ChatOpenRouter(fields);
    let final: AIMessageChunk | undefined;
    for await (const chunk of await model.stream('hi')) {
      final = final == null ? (chunk as AIMessageChunk) : concat(final, chunk as AIMessageChunk);
    }
    expect(final?.response_metadata?.model_name).toBe('anthropic/claude-sonnet-5.5');
    expect(getModelEndUsage(final)?.resolved_model).toBe('anthropic/claude-sonnet-5.5');
  });
});
