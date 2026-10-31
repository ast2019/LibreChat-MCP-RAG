import type { ChatMessage } from './types';
import {
  validateChatTools,
  applyChatClientTools,
  convertChatMessages,
  validateChatToolChoice,
  validateChatToolExchanges,
} from './clientTools';

const tool = (name: string) => ({ type: 'function', function: { name } });

describe('validateChatTools', () => {
  it('accepts function tools and refuses malformed or repeated ones', () => {
    expect(validateChatTools(undefined)).toBeUndefined();
    expect(validateChatTools([tool('read_file'), tool('run-cmd')])).toBeUndefined();
    expect(validateChatTools({})).toBe('tools must be an array');
    expect(validateChatTools([{ type: 'web_search' }])).toBe('tools[0].type must be "function"');
    expect(validateChatTools([tool('has space')])).toMatch(/function\.name/);
    expect(validateChatTools([tool('a'), tool('a')])).toMatch(/declared twice/);
    expect(
      validateChatTools([{ type: 'function', function: { name: 'a', parameters: [] } }]),
    ).toMatch(/JSON Schema/);
  });
});

describe('validateChatToolChoice', () => {
  it('accepts the OpenAI values and only a declared named function', () => {
    for (const choice of ['none', 'auto', 'required']) {
      expect(validateChatToolChoice(choice, [])).toBeUndefined();
    }
    expect(
      validateChatToolChoice({ type: 'function', function: { name: 'a' } }, [tool('a')]),
    ).toBeUndefined();
    expect(
      validateChatToolChoice({ type: 'function', function: { name: 'b' } }, [tool('a')]),
    ).toMatch(/not in tools/);
    expect(validateChatToolChoice('always', [])).toMatch(/tool_choice must be/);
  });
});

describe('applyChatClientTools', () => {
  it('leaves the agent alone without tools or with tool_choice none', () => {
    const agent = { toolDefinitions: [{ name: 'web_search' }] } as never;
    expect(
      applyChatClientTools({
        agent,
        agentCount: 1,
        hasSubagents: false,
        tools: undefined,
        toolChoice: undefined,
      }),
    ).toEqual({ ok: true, names: [] });
    expect(
      applyChatClientTools({
        agent,
        agentCount: 1,
        hasSubagents: false,
        tools: [tool('a') as never],
        toolChoice: 'none',
      }),
    ).toEqual({ ok: true, names: [] });
    expect((agent as { toolDefinitions: unknown[] }).toolDefinitions).toEqual([
      { name: 'web_search' },
    ]);
  });

  it('refuses a model that runs as several agents', () => {
    const result = applyChatClientTools({
      agent: {},
      agentCount: 2,
      hasSubagents: false,
      tools: [tool('a') as never],
      toolChoice: 'auto',
    });
    expect(result.ok).toBe(false);
  });

  it('asks the model to call a tool for required and a named function', () => {
    const agent: { toolDefinitions?: Array<{ name: string; description?: string }> } = {};
    applyChatClientTools({
      agent: agent as never,
      agentCount: 1,
      hasSubagents: false,
      tools: [tool('a') as never, tool('b') as never],
      toolChoice: { type: 'function', function: { name: 'b' } },
    });
    expect(agent.toolDefinitions?.map((def) => def.description)).toEqual([
      undefined,
      'Call this tool in this turn.',
    ]);
  });
});

describe('tool exchanges in the history', () => {
  const call = { id: 'c1', type: 'function' as const, function: { name: 'a', arguments: '{}' } };

  it('refuses a tool message that answers no call, or a call twice', () => {
    expect(validateChatToolExchanges([{ role: 'tool', tool_call_id: 'c1', content: 'x' }])).toMatch(
      /did not make/,
    );
    const twice: ChatMessage[] = [
      { role: 'assistant', content: null, tool_calls: [call] },
      { role: 'tool', tool_call_id: 'c1', content: 'x' },
      { role: 'tool', tool_call_id: 'c1', content: 'y' },
    ];
    expect(validateChatToolExchanges(twice)).toMatch(/already answered/);
    expect(validateChatToolExchanges([{ role: 'tool', content: 'x' }])).toMatch(/tool_call_id/);
  });

  it('folds a call and its result into one assistant turn, keeping its text', () => {
    expect(
      convertChatMessages([
        { role: 'assistant', content: 'Reading it.', tool_calls: [call] },
        { role: 'tool', tool_call_id: 'c1', content: [{ type: 'text', text: 'body' }] },
        { role: 'user', content: 'thanks' },
      ]),
    ).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Reading it.' },
          { type: 'tool_call', tool_call: { id: 'c1', name: 'a', args: '{}', output: 'body' } },
        ],
      },
      { role: 'user', content: 'thanks' },
    ]);
  });

  it('drops a call left unanswered', () => {
    expect(convertChatMessages([{ role: 'assistant', content: null, tool_calls: [call] }])).toEqual(
      [],
    );
  });
});
