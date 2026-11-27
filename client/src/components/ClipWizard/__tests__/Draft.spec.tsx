import { Provider, createStore } from 'jotai';
import { MemoryRouter } from 'react-router-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  clipWizardImagesAtom,
  clipWizardModelIdAtom,
  clipWizardStepAtom,
  clipWizardStoryboardAtom,
  clipWizardTopicAtom,
} from '~/store/clipWizard';
import { wizardConfig as config } from 'test/clipwizard';
import Topic from '../Topic';

jest.mock('@librechat/client', () =>
  jest.requireActual<typeof import('test/clipwizard')>('test/clipwizard').withNativeDropdown(),
);
const mockDraft = jest.fn();
let mockLoading = false;
jest.mock('~/data-provider', () => ({
  useDraftClipWizardMutation: () => ({ mutate: mockDraft, isLoading: mockLoading }),
}));
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

const drafted = { title: 'Solar', scenes: [{ type: 'hook', narration: 'Hello' }] };

function mount() {
  const store = createStore();
  store.set(clipWizardTopicAtom, 'why solar is cheaper');
  render(
    <Provider store={store}>
      <MemoryRouter>
        <Topic config={config} />
      </MemoryRouter>
    </Provider>,
  );
  return store;
}

const write = () =>
  fireEvent.click(screen.getByRole('button', { name: 'com_clipwizard_draft_write' }));
const fail = (code: string) =>
  mockDraft.mockImplementation((_vars, options) =>
    options.onError({ response: { data: { error: { code } } } }),
  );

describe('ClipWizard draft with AI', () => {
  beforeEach(() => {
    mockDraft.mockReset();
    mockLoading = false;
  });

  it('sends the topic, settings, default model and image source, then lands on the storyboard', () => {
    mockDraft.mockImplementation((_vars, options) =>
      options.onSuccess({ storyboard: drafted, credits: 3 }),
    );
    const store = mount();
    write();
    expect(mockDraft.mock.calls[0][0]).toEqual({
      topic: 'why solar is cheaper',
      settings: { aspectRatio: '9:16', targetDurationSec: 30 },
      modelId: 'm1',
      images: { source: 'builtin' },
    });
    expect(store.get(clipWizardStoryboardAtom)).toEqual(drafted);
    expect(store.get(clipWizardStepAtom)).toBe('storyboard');
  });

  it('sends the model the user picked and the image source from settings', () => {
    mockDraft.mockImplementation(() => undefined);
    const store = mount();
    act(() =>
      store.set(clipWizardImagesAtom, { source: 'openrouter', modelId: 'img-a', maxCredits: 20 }),
    );
    fireEvent.change(screen.getByTestId('clipwizard-model'), { target: { value: 'm2' } });
    expect(store.get(clipWizardModelIdAtom)).toBe('m2');
    write();
    expect(mockDraft.mock.calls[0][0]).toMatchObject({
      modelId: 'm2',
      images: { source: 'openrouter', modelId: 'img-a', maxCredits: 20 },
    });
  });

  it('lists models by label only', () => {
    mount();
    expect(screen.getByRole('option', { name: 'Model Two' })).toBeInTheDocument();
    expect(screen.queryByText(/openrouter/i)).toBeNull();
  });

  it('tells the user to top up when credit is out and stays on the topic step', () => {
    fail('insufficient_credit');
    const store = mount();
    write();
    expect(screen.getByTestId('clipwizard-error')).toHaveTextContent('com_clipwizard_error_credit');
    expect(screen.getByRole('link', { name: 'com_clipwizard_topup' })).toHaveAttribute(
      'href',
      '/payment',
    );
    expect(store.get(clipWizardStepAtom)).toBe('topic');
    expect(store.get(clipWizardStoryboardAtom)).toBeNull();
  });

  it('says the provider failed and nothing was charged', () => {
    fail('provider_failed');
    mount();
    write();
    expect(screen.getByTestId('clipwizard-error')).toHaveTextContent(
      'com_clipwizard_error_provider',
    );
    expect(screen.queryByRole('link', { name: 'com_clipwizard_topup' })).toBeNull();
  });

  it.each([
    ['cap_exceeded', 'com_clipwizard_error_cap'],
    ['model_unavailable', 'com_clipwizard_error_model'],
  ])('maps %s to its own copy', (code, key) => {
    fail(code);
    mount();
    write();
    expect(screen.getByTestId('clipwizard-error')).toHaveTextContent(key);
  });

  it('shows a loading status and disables the button while writing', () => {
    mockLoading = true;
    mount();
    expect(screen.getByRole('status')).toHaveTextContent('com_clipwizard_draft_working');
    expect(screen.getByRole('button', { name: 'com_clipwizard_draft_write' })).toBeDisabled();
  });

  it('does not call the model for a topic that is too short', () => {
    const store = mount();
    act(() => store.set(clipWizardTopicAtom, 'ab'));
    expect(screen.getByRole('button', { name: 'com_clipwizard_draft_write' })).toBeDisabled();
    expect(mockDraft).not.toHaveBeenCalled();
  });
});
