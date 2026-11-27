import { Provider, createStore } from 'jotai';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { clipWizardCheckedAtom, clipWizardStoryboardAtom } from '~/store/clipWizard';
import { wizardConfig as config } from 'test/clipwizard';
import Chat from '../Chat';

jest.mock('@librechat/client', () =>
  jest.requireActual<typeof import('test/clipwizard')>('test/clipwizard').withNativeDropdown(),
);
const mockChat = jest.fn();
let mockLoading = false;
jest.mock('~/data-provider', () => ({
  useChatClipWizardMutation: () => ({ mutate: mockChat, isLoading: mockLoading }),
}));
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

const sb = { title: 't', scenes: [{ type: 'hook', narration: 'a' }] };
const edited = { title: 't2', scenes: [{ type: 'hook', narration: 'b' }] };

function mount(withStoryboard = true) {
  const store = createStore();
  if (withStoryboard) {
    store.set(clipWizardStoryboardAtom, sb);
    store.set(clipWizardCheckedAtom, { storyboard: sb, scenes: 1, durationSec: 3 });
  }
  render(
    <Provider store={store}>
      <MemoryRouter>
        <Chat config={config} />
      </MemoryRouter>
    </Provider>,
  );
  return store;
}

const say = (text: string) => {
  fireEvent.change(screen.getByLabelText('com_clipwizard_chat_label'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'com_clipwizard_chat_send' }));
};

describe('ClipWizard chat panel', () => {
  beforeEach(() => {
    mockChat.mockReset();
    mockLoading = false;
  });

  it('replaces the storyboard when the reply carries one, and clears the check', () => {
    mockChat.mockImplementation((_vars, options) =>
      options.onSuccess({ reply: 'Done', storyboard: edited, credits: 2 }),
    );
    const store = mount();
    say('change it');
    expect(mockChat.mock.calls[0][0]).toMatchObject({
      modelId: 'm1',
      storyboard: sb,
      messages: [{ role: 'user', content: 'change it' }],
    });
    expect(store.get(clipWizardStoryboardAtom)).toEqual(edited);
    expect(store.get(clipWizardCheckedAtom)?.storyboard).not.toBe(edited);
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByTestId('clipwizard-chat-updated')).toBeInTheDocument();
  });

  it('keeps the storyboard when the reply is text only', () => {
    mockChat.mockImplementation((_vars, options) =>
      options.onSuccess({ reply: 'It has one scene.', storyboard: null, credits: 1 }),
    );
    const store = mount();
    say('how long is it?');
    expect(store.get(clipWizardStoryboardAtom)).toBe(sb);
    expect(store.get(clipWizardCheckedAtom)?.storyboard).toBe(sb);
    expect(screen.getByText('It has one scene.')).toBeInTheDocument();
    expect(screen.queryByTestId('clipwizard-chat-updated')).toBeNull();
  });

  it('sends the earlier turns and the model picked in the panel', () => {
    mockChat.mockImplementation((_vars, options) =>
      options.onSuccess({ reply: 'ok', storyboard: null, credits: 1 }),
    );
    mount();
    fireEvent.change(screen.getByTestId('clipwizard-model'), { target: { value: 'm2' } });
    say('first');
    say('second');
    expect(mockChat.mock.calls[1][0].modelId).toBe('m2');
    expect(mockChat.mock.calls[1][0].messages.map((m: { content: string }) => m.content)).toEqual([
      'first',
      'ok',
      'second',
    ]);
  });

  it('shows the stable-code notice on a failure', () => {
    mockChat.mockImplementation((_vars, options) =>
      options.onError({ response: { data: { error: { code: 'provider_failed' } } } }),
    );
    mount();
    say('x');
    expect(screen.getByTestId('clipwizard-error')).toHaveTextContent(
      'com_clipwizard_error_provider',
    );
  });

  it('disables send while a request is in flight and announces progress', () => {
    mockLoading = true;
    mount();
    fireEvent.change(screen.getByLabelText('com_clipwizard_chat_label'), {
      target: { value: 'x' },
    });
    expect(screen.getByRole('button', { name: 'com_clipwizard_chat_send' })).toBeDisabled();
    expect(screen.getByTestId('clipwizard-chat-loading')).toBeInTheDocument();
    expect(screen.getByTestId('clipwizard-chat-log')).toHaveAttribute('aria-live', 'polite');
  });

  it('cannot send without a storyboard', () => {
    mount(false);
    expect(screen.getByLabelText('com_clipwizard_chat_label')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'com_clipwizard_chat_send' })).toBeDisabled();
    expect(mockChat).not.toHaveBeenCalled();
  });
});
