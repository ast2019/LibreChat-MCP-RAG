import { getChatMode } from '../useChatMode';

jest.mock('~/data-provider', () => ({ useGetStartupConfig: () => ({ data: undefined }) }));
jest.mock('~/Providers', () => ({ useChatContext: () => ({ conversation: null }) }));

describe('getChatMode', () => {
  it('reads admin before local, since admin-only specs also run locally', () => {
    expect(getChatMode({ adminOnly: true, privacy: 'local' })).toBe('admin');
  });

  it('maps a local spec to local and a private spec to confidential', () => {
    expect(getChatMode({ privacy: 'local' })).toBe('local');
    expect(getChatMode({ privacy: 'private' })).toBe('confidential');
  });

  it('leaves an ordinary or missing spec without a mode', () => {
    expect(getChatMode({})).toBeNull();
    expect(getChatMode(undefined)).toBeNull();
    expect(getChatMode(null)).toBeNull();
  });
});
