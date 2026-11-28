import { Provider, createStore } from 'jotai';
import { MemoryRouter } from 'react-router-dom';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import {
  clipWizardImagesAtom,
  clipWizardStoryboardAtom,
  clipWizardVoiceIdAtom,
} from '~/store/clipWizard';
import { wizardConfig } from 'test/clipwizard';
import Storyboard from '../Storyboard';

jest.mock('@librechat/client', () =>
  jest.requireActual<typeof import('test/clipwizard')>('test/clipwizard').withNativeDropdown(),
);
const mockValidate = jest.fn();
const mockEstimate = jest.fn();
const mockModel = jest.fn();
jest.mock('~/data-provider', () => ({
  useValidateClipStoryboardMutation: () => ({ mutate: mockValidate, isLoading: false }),
  useClipStyleSampleQuery: () => ({ data: undefined, isLoading: false }),
  useEstimateClipWizardMutation: () => ({ mutate: mockEstimate, isLoading: false }),
  useDraftClipWizardMutation: () => ({ mutate: mockModel }),
  useChatClipWizardMutation: () => ({ mutate: mockModel }),
}));
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

const sb = {
  title: 't',
  scenes: [
    { type: 'hook', narration: 'one' },
    { type: 'stat', narration: 'two' },
    { type: 'cta', narration: 'three' },
  ],
};
const narrations = (store: ReturnType<typeof createStore>) =>
  (store.get(clipWizardStoryboardAtom)?.scenes ?? []).map((s) => s.narration);

function mount(config = wizardConfig) {
  const store = createStore();
  store.set(clipWizardStoryboardAtom, sb);
  render(
    <Provider store={store}>
      <MemoryRouter>
        <Storyboard config={config} />
      </MemoryRouter>
    </Provider>,
  );
  return store;
}

const check = () =>
  fireEvent.click(screen.getByRole('button', { name: /com_clipwizard_validate/ }));
const approve = () =>
  mockValidate.mockImplementation((_vars, options) =>
    options.onSuccess({ ok: true, scenes: 3, durationSec: 9, notes: [] }),
  );
const estimateOk = {
  ok: true,
  items: { narrationCredits: 12, imageCredits: 14 },
  imageCount: 2,
  totalCredits: 26,
  capCredits: 50,
};

describe('ClipWizard manual edits', () => {
  beforeEach(() => {
    [mockValidate, mockEstimate, mockModel].forEach((fn) => fn.mockReset());
    approve();
    mockEstimate.mockImplementation((_vars, options) => options.onSuccess(estimateOk));
  });

  it('reorders, deletes and edits without any request and needs a new check each time', () => {
    const store = mount();
    check();
    expect(screen.getByTestId('clipwizard-valid')).toBeInTheDocument();
    mockValidate.mockClear();
    mockEstimate.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /com_clipwizard_scene_down.*1/ }));
    expect(narrations(store)).toEqual(['two', 'one', 'three']);
    expect(screen.queryByTestId('clipwizard-valid')).toBeNull();
    expect(screen.getByRole('button', { name: 'com_clipwizard_next' })).toBeDisabled();

    check();
    expect(screen.getByTestId('clipwizard-valid')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /com_clipwizard_scene_up.*3/ }));
    expect(narrations(store)).toEqual(['two', 'three', 'one']);
    expect(screen.queryByTestId('clipwizard-valid')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /com_clipwizard_scene_delete.*2/ }));
    expect(narrations(store)).toEqual(['two', 'one']);

    fireEvent.change(screen.getAllByLabelText('com_clipwizard_scene_narration')[0], {
      target: { value: 'new' },
    });
    expect(narrations(store)).toEqual(['new', 'one']);

    expect(mockModel).not.toHaveBeenCalled();
    expect(mockValidate).toHaveBeenCalledTimes(1);
  });

  it('changes voice and style locally, clears the check and never calls the model', () => {
    const store = mount();
    check();
    fireEvent.change(screen.getByTestId('clipwizard-theme-select'), { target: { value: 'dark' } });
    expect(store.get(clipWizardStoryboardAtom)?.theme).toBe('dark');
    expect(screen.queryByTestId('clipwizard-valid')).toBeNull();
    check();
    fireEvent.change(screen.getByTestId('clipwizard-voice-select'), {
      target: { value: 'eleven-sarah' },
    });
    expect(store.get(clipWizardVoiceIdAtom)).toBe('eleven-sarah');
    expect(screen.queryByTestId('clipwizard-valid')).toBeNull();
    fireEvent.change(screen.getByTestId('clipwizard-theme-select'), {
      target: { value: '__default__' },
    });
    expect(store.get(clipWizardStoryboardAtom)?.theme).toBeUndefined();
    expect(mockModel).not.toHaveBeenCalled();
  });

  it('disables move and delete at the edges', () => {
    mount();
    expect(screen.getByRole('button', { name: /com_clipwizard_scene_up.*1/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /com_clipwizard_scene_down.*3/ })).toBeDisabled();
  });

  it('shows the estimate with the cap after a successful check and sends voice and images', () => {
    const store = mount();
    act(() => {
      store.set(clipWizardVoiceIdAtom, 'eleven-sarah');
      store.set(clipWizardImagesAtom, { source: 'openrouter', modelId: 'img-a', maxCredits: 20 });
    });
    expect(screen.queryByTestId('clipwizard-estimate')).toBeNull();
    check();
    expect(mockEstimate.mock.calls[0][0]).toEqual({
      storyboard: sb,
      settings: {
        voiceId: 'eleven-sarah',
        images: { source: 'openrouter', modelId: 'img-a', maxCredits: 20 },
      },
    });
    const box = screen.getByTestId('clipwizard-estimate');
    expect(within(box).getByText(/com_clipwizard_estimate_total.*26/)).toBeInTheDocument();
    expect(within(box).getByText(/com_clipwizard_estimate_narration.*12/)).toBeInTheDocument();
    expect(within(box).getByText(/com_clipwizard_estimate_images/)).toHaveTextContent('14');
    expect(within(box).getByText(/com_clipwizard_estimate_cap.*50/)).toBeInTheDocument();
  });

  it('does not estimate when the check finds problems', () => {
    mockValidate.mockImplementation((_vars, options) =>
      options.onSuccess({ ok: false, issues: [{ field: 'scenes[0].x', message: 'bad' }] }),
    );
    mount();
    check();
    expect(mockEstimate).not.toHaveBeenCalled();
  });

  it('says to top up when the estimate answers insufficient credit', () => {
    mockEstimate.mockImplementation((_vars, options) =>
      options.onError({ response: { data: { error: { code: 'insufficient_credit' } } } }),
    );
    mount();
    check();
    expect(screen.getByTestId('clipwizard-error')).toHaveAttribute(
      'data-code',
      'insufficient_credit',
    );
    expect(screen.getByRole('link', { name: 'com_clipwizard_topup' })).toBeInTheDocument();
  });

  it('shows the cap refusal copy from the estimate', () => {
    mockEstimate.mockImplementation((_vars, options) =>
      options.onError({ response: { data: { error: { code: 'cap_exceeded' } } } }),
    );
    mount();
    check();
    expect(screen.getByTestId('clipwizard-error')).toHaveTextContent('com_clipwizard_error_cap');
  });
});
