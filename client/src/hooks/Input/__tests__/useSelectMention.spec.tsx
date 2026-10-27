import { renderHook } from '@testing-library/react';
import { Constants, EModelEndpoint } from 'librechat-data-provider';
import type { TConversation, TModelSpec, TEndpointsConfig } from 'librechat-data-provider';
import useSelectMention, {
  isConversationSpecLocked,
  isPersistedConversation,
} from '../useSelectMention';

const mockShowToast = jest.fn();
const mockModularChat = { value: true };

jest.mock('recoil', () => ({
  ...jest.requireActual('recoil'),
  useRecoilValue: jest.fn((atom: { key?: string }) =>
    atom?.key === 'modularChat' ? mockModularChat.value : [],
  ),
}));

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useSearchParams: () => [new URLSearchParams()],
}));

jest.mock('@librechat/client', () => ({
  useToastContext: () => ({ showToast: mockShowToast }),
}));

const mockSpecs: TModelSpec[] = [
  {
    name: 'private-fast',
    label: 'Private Fast',
    privacy: 'private',
    preset: { endpoint: 'OpenRouterPrivate', model: 'private-model' },
  },
  {
    name: 'private-smart',
    label: 'Private Smart',
    privacy: 'private',
    preset: { endpoint: 'OpenRouterPrivate', model: 'private-model-2' },
  },
  {
    name: 'local',
    label: 'Local',
    privacy: 'local',
    preset: { endpoint: 'ollama', model: 'llama3' },
  },
  {
    name: 'normal',
    label: 'Normal',
    preset: { endpoint: 'OpenRouter', model: 'normal-model' },
  },
] as TModelSpec[];

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: { modelSpecs: { list: mockSpecs } } }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useDefaultConvo:
    () =>
    ({ conversation, preset }: { conversation: TConversation; preset: TConversation }) => ({
      ...conversation,
      ...preset,
      /* Like the real builder: the modular switch keeps the conversation's identity. */
      conversationId: conversation.conversationId,
    }),
}));

jest.mock('~/store', () => ({
  __esModule: true,
  default: {
    modularChat: { key: 'modularChat' },
    availableTools: { key: 'availableTools' },
  },
}));

const endpointsConfig = {
  OpenRouterPrivate: { type: EModelEndpoint.custom },
  OpenRouter: { type: EModelEndpoint.custom },
  ollama: { type: EModelEndpoint.custom },
} as unknown as TEndpointsConfig;

const spec = (name: string) => mockSpecs.find((s) => s.name === name) as TModelSpec;

function setup(conversation: Partial<TConversation> | null) {
  const newConversation = jest.fn();
  const { result } = renderHook(() =>
    useSelectMention({
      modelSpecs: mockSpecs,
      endpointsConfig,
      newConversation,
      returnHandlers: true,
      getConversation: () => conversation as TConversation | null,
    }),
  );
  return {
    newConversation,
    onSelectSpec: result.current.onSelectSpec as (s?: TModelSpec) => boolean,
    onSelectEndpoint: result.current.onSelectEndpoint as (
      e?: string | null,
      kwargs?: { model?: string },
    ) => boolean,
  };
}

const existing = (specName: string | null, endpoint: string): Partial<TConversation> => ({
  conversationId: 'convo-1',
  endpoint: endpoint as EModelEndpoint,
  model: 'm',
  spec: specName,
});

describe('useSelectMention privacy lock', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockModularChat.value = true;
  });

  describe('helpers', () => {
    it('treats only real ids as persisted conversations', () => {
      expect(isPersistedConversation('convo-1')).toBe(true);
      expect(isPersistedConversation(Constants.NEW_CONVO)).toBe(false);
      expect(isPersistedConversation(null)).toBe(false);
      expect(isPersistedConversation('')).toBe(false);
    });

    it('locks only a persisted private conversation', () => {
      expect(isConversationSpecLocked(existing('private-fast', 'x'), mockSpecs)).toBe(true);
      expect(isConversationSpecLocked(existing('local', 'x'), mockSpecs)).toBe(false);
      expect(
        isConversationSpecLocked(
          { conversationId: Constants.NEW_CONVO as string, spec: 'private-fast' },
          mockSpecs,
        ),
      ).toBe(false);
    });
  });

  it.each(['normal', 'local', 'private-smart'])(
    'R1: refuses switching a private conversation to %s with a warning toast',
    (target) => {
      const { onSelectSpec, newConversation } = setup(
        existing('private-fast', 'OpenRouterPrivate'),
      );
      expect(onSelectSpec(spec(target))).toBe(false);
      expect(newConversation).not.toHaveBeenCalled();
      expect(mockShowToast).toHaveBeenCalledWith({
        message: 'com_ui_private_chat_model_locked',
        status: 'warning',
      });
    },
  );

  it('R1: refuses picking a bare endpoint/model in a private conversation', () => {
    const { onSelectEndpoint, newConversation } = setup(
      existing('private-fast', 'OpenRouterPrivate'),
    );
    expect(onSelectEndpoint('OpenRouter', { model: 'other' })).toBe(false);
    expect(newConversation).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ status: 'warning' }));
  });

  it('R1: reselecting the same private spec is not refused', () => {
    const { onSelectSpec } = setup(existing('private-fast', 'OpenRouterPrivate'));
    expect(onSelectSpec(spec('private-fast'))).toBe(true);
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it.each([
    ['normal', 'OpenRouter'],
    ['local', 'ollama'],
    [null, 'OpenRouter'],
  ])('R2: opens a private spec from a %s conversation in a new chat', (current, endpoint) => {
    const { onSelectSpec, newConversation } = setup(existing(current, endpoint));
    expect(onSelectSpec(spec('private-fast'))).toBe(true);
    expect(newConversation).toHaveBeenCalledTimes(1);
    const [params] = newConversation.mock.calls[0];
    expect(params.template).toEqual({
      conversationId: Constants.NEW_CONVO as string,
      chatProjectId: null,
    });
    expect(params.preset).toMatchObject({ spec: 'private-fast', endpoint: 'OpenRouterPrivate' });
    expect(params.keepAddedConvos).toBe(false);
    expect(params.keepLatestMessage).toBeUndefined();
    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_ui_private_chat_opened_new',
      status: 'info',
    });
  });

  it('switches a local conversation to another spec in place', () => {
    const { onSelectSpec, newConversation } = setup(existing('local', 'ollama'));
    expect(onSelectSpec(spec('normal'))).toBe(true);
    const [params] = newConversation.mock.calls[0];
    expect(params.template.conversationId).toBe('convo-1');
    expect(params.preset).toMatchObject({ spec: 'normal' });
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('gives a new chat a free choice of a private spec', () => {
    const { onSelectSpec, newConversation } = setup({
      conversationId: Constants.NEW_CONVO as string,
      endpoint: 'OpenRouter' as EModelEndpoint,
      spec: 'normal',
    });
    expect(onSelectSpec(spec('private-fast'))).toBe(true);
    expect(newConversation).toHaveBeenCalledTimes(1);
    expect(newConversation.mock.calls[0][0].keepAddedConvos).toBe(false);
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('lets a new private chat switch freely', () => {
    const { onSelectSpec } = setup({
      conversationId: Constants.NEW_CONVO as string,
      endpoint: 'OpenRouterPrivate' as EModelEndpoint,
      spec: 'private-fast',
    });
    expect(onSelectSpec(spec('normal'))).toBe(true);
    expect(mockShowToast).not.toHaveBeenCalled();
  });
});
