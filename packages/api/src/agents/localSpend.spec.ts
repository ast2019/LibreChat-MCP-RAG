import {
  isLocalChatSpend,
  toLocalSpendContext,
  MESSAGE_LOCAL_TRANSACTION_CONTEXT,
  DEFAULT_LOCAL_ENDPOINTS,
} from './localSpend';

describe('isLocalChatSpend', () => {
  it('is true when the model spec privacy is local', () => {
    expect(
      isLocalChatSpend({
        endpoint: 'OpenRouter',
        spec: 'on-prem',
        specs: [{ name: 'on-prem', privacy: 'local' }],
        localEndpoints: [],
      }),
    ).toBe(true);
  });

  it('is true when the conversation endpoint is listed as local', () => {
    expect(
      isLocalChatSpend({
        endpoint: 'Local',
        localEndpoints: DEFAULT_LOCAL_ENDPOINTS,
      }),
    ).toBe(true);
  });

  it('is true when the agent or spec preset uses a local endpoint', () => {
    expect(
      isLocalChatSpend({
        endpoint: 'agents',
        agentEndpoint: 'LocalUncensored',
      }),
    ).toBe(true);
    expect(
      isLocalChatSpend({
        endpoint: 'agents',
        spec: 'hive',
        specs: [{ name: 'hive', preset: { endpoint: 'Local' } }],
      }),
    ).toBe(true);
  });

  it('is false for ordinary cloud chats', () => {
    expect(
      isLocalChatSpend({
        endpoint: 'OpenRouter',
        spec: 'flash',
        specs: [{ name: 'flash' }],
      }),
    ).toBe(false);
  });
});

describe('toLocalSpendContext', () => {
  it('appends _local once', () => {
    expect(toLocalSpendContext('message', true)).toBe(MESSAGE_LOCAL_TRANSACTION_CONTEXT);
    expect(toLocalSpendContext('message_local', true)).toBe('message_local');
    expect(toLocalSpendContext('title', true)).toBe('title_local');
    expect(toLocalSpendContext('message', false)).toBe('message');
  });
});
