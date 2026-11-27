import { Provider, createStore } from 'jotai';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { clipWizardStepAtom, clipWizardVoiceIdAtom } from '~/store/clipWizard';
import { wizardConfig as config } from 'test/clipwizard';
import Settings from '../Settings';

const mockMutate = jest.fn();
jest.mock('@librechat/client', () =>
  jest.requireActual<typeof import('test/clipwizard')>('test/clipwizard').withNativeDropdown(),
);
jest.mock('~/data-provider', () => ({
  useClipVoiceSampleMutation: () => ({ mutate: mockMutate }),
}));
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

const play = jest.fn(() => Promise.resolve());
const AudioMock = jest.fn(() => ({ play }));

function setup() {
  const store = createStore();
  render(
    <Provider store={store}>
      <MemoryRouter>
        <Settings config={config} />
      </MemoryRouter>
    </Provider>,
  );
  return store;
}

const answerError = (code: string) =>
  mockMutate.mockImplementation((_vars, options) =>
    options.onError({ response: { data: { error: { code } } } }),
  );

describe('ClipWizard Settings', () => {
  beforeEach(() => {
    mockMutate.mockReset();
    play.mockClear();
    AudioMock.mockClear();
    (globalThis as unknown as { Audio: unknown }).Audio = AudioMock;
  });

  it('lists voices with price hints and a sample button only for voices that have one', () => {
    setup();
    expect(screen.getByText('Sarah')).toBeInTheDocument();
    expect(screen.getByText('com_clipwizard_voice_paid')).toBeInTheDocument();
    expect(screen.getByText('com_clipwizard_voice_free')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /com_clipwizard_voice_play/ })).toHaveLength(1);
  });

  it('selects a voice into the store and moves on', () => {
    const store = setup();
    fireEvent.click(screen.getByLabelText(/Dilara/));
    expect(store.get(clipWizardVoiceIdAtom)).toBe('fa-IR-DilaraNeural');
    fireEvent.click(screen.getByRole('button', { name: 'com_clipwizard_next' }));
    expect(store.get(clipWizardStepAtom)).toBe('storyboard');
  });

  it('asks for a sample once, plays it, and replays without asking again', () => {
    mockMutate.mockImplementation((_vars, options) =>
      options.onSuccess({
        voiceId: 'eleven-sarah',
        mime: 'audio/mpeg',
        base64: 'AAAA',
        cached: false,
      }),
    );
    setup();
    const button = screen.getByRole('button', { name: /com_clipwizard_voice_play/ });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate.mock.calls[0][0]).toEqual({ voiceId: 'eleven-sarah' });
    expect(AudioMock).toHaveBeenCalledWith('data:audio/mpeg;base64,AAAA');
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('shows a loading state while the sample is made', () => {
    mockMutate.mockImplementation(() => undefined);
    setup();
    const button = screen.getByRole('button', { name: /com_clipwizard_voice_play/ });
    fireEvent.click(button);
    expect(button).toBeDisabled();
  });

  it('tells the user to top up when credit is out', () => {
    answerError('insufficient_credit');
    setup();
    fireEvent.click(screen.getByRole('button', { name: /com_clipwizard_voice_play/ }));
    expect(screen.getByTestId('clipwizard-error')).toHaveTextContent('com_clipwizard_error_credit');
    expect(screen.getByRole('link', { name: 'com_clipwizard_topup' })).toHaveAttribute(
      'href',
      '/payment',
    );
    expect(play).not.toHaveBeenCalled();
  });

  it('says the provider failed and nothing was charged', () => {
    answerError('provider_failed');
    setup();
    fireEvent.click(screen.getByRole('button', { name: /com_clipwizard_voice_play/ }));
    const alert = screen.getByTestId('clipwizard-error');
    expect(alert).toHaveAttribute('data-code', 'provider_failed');
    expect(alert).toHaveTextContent('com_clipwizard_error_provider');
    expect(screen.queryByRole('link', { name: 'com_clipwizard_topup' })).toBeNull();
  });

  it('shows an empty state without voices', () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <MemoryRouter>
          <Settings config={{ ...config, voices: [] }} />
        </MemoryRouter>
      </Provider>,
    );
    expect(screen.getByText('com_clipwizard_voice_empty')).toBeInTheDocument();
  });
});
