import { Provider, createStore } from 'jotai';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  clipWizardJobIdAtom,
  clipWizardStepAtom,
  clipWizardStoryboardAtom,
} from '~/store/clipWizard';
import { wizardConfig as config } from 'test/clipwizard';
import Storyboard from '../Storyboard';
import Render from '../Render';
import Topic from '../Topic';

const mockValidate = jest.fn();
const mockStart = jest.fn();
jest.mock('@librechat/client', () =>
  jest.requireActual<typeof import('test/clipwizard')>('test/clipwizard').withNativeDropdown(),
);
const mockEstimate = jest.fn();
jest.mock('~/data-provider', () => ({
  useDraftClipWizardMutation: () => ({ mutate: jest.fn(), isLoading: false }),
  useEstimateClipWizardMutation: () => ({ mutate: mockEstimate, isLoading: false }),
  useValidateClipStoryboardMutation: () => ({ mutate: mockValidate, isLoading: false }),
  useStartClipRenderMutation: () => ({ mutate: mockStart, isLoading: false }),
}));
jest.mock('~/components/Chat/Messages/Content/MediaJob', () => ({
  __esModule: true,
  default: ({ jobId }: { jobId: string }) => <span data-testid="job-card">{jobId}</span>,
}));
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

const sb = {
  title: 't',
  scenes: [
    { type: 'hook', narration: 'a' },
    { type: 'stat', narration: 'b' },
  ],
};

function mount(ui: JSX.Element, seed?: (store: ReturnType<typeof createStore>) => void) {
  const store = createStore();
  seed?.(store);
  render(
    <Provider store={store}>
      <MemoryRouter>{ui}</MemoryRouter>
    </Provider>,
  );
  return store;
}

describe('ClipWizard topic step', () => {
  it('accepts a pasted storyboard as an advanced option', () => {
    const store = mount(<Topic config={config} />);
    fireEvent.change(screen.getByLabelText('com_clipwizard_paste_label'), {
      target: { value: JSON.stringify(sb) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'com_clipwizard_paste_use' }));
    expect(store.get(clipWizardStoryboardAtom)).toEqual(sb);
  });

  it('rejects text that is not a storyboard', () => {
    const store = mount(<Topic config={config} />);
    fireEvent.change(screen.getByLabelText('com_clipwizard_paste_label'), {
      target: { value: '{"a":1}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'com_clipwizard_paste_use' }));
    expect(screen.getByRole('alert')).toHaveTextContent('com_clipwizard_paste_invalid');
    expect(store.get(clipWizardStoryboardAtom)).toBeNull();
  });
});

describe('ClipWizard storyboard step', () => {
  beforeEach(() => mockValidate.mockReset());
  const seed = (store: ReturnType<typeof createStore>) => store.set(clipWizardStoryboardAtom, sb);

  it('edits narration, shows issues under their scene, and allows next only when valid', () => {
    mockValidate.mockImplementation((_vars, options) =>
      options.onSuccess({
        ok: false,
        issues: [{ field: 'scenes[1].value', message: 'must be a number' }],
      }),
    );
    const store = mount(<Storyboard config={config} />, seed);
    fireEvent.change(screen.getAllByLabelText('com_clipwizard_scene_narration')[0], {
      target: { value: 'new' },
    });
    expect(
      (store.get(clipWizardStoryboardAtom)?.scenes[0] as { narration: string }).narration,
    ).toBe('new');
    fireEvent.click(screen.getByRole('button', { name: /com_clipwizard_validate/ }));
    expect(screen.getByTestId('clipwizard-scene-1')).toHaveTextContent(
      'scenes[1].value: must be a number',
    );
    expect(screen.getByTestId('clipwizard-scene-0')).not.toHaveTextContent('must be a number');
    expect(screen.getByRole('button', { name: 'com_clipwizard_next' })).toBeDisabled();
  });

  it('enables next after a valid check', () => {
    mockValidate.mockImplementation((_vars, options) =>
      options.onSuccess({ ok: true, scenes: 2, durationSec: 6, notes: [] }),
    );
    const store = mount(<Storyboard config={config} />, seed);
    fireEvent.click(screen.getByRole('button', { name: /com_clipwizard_validate/ }));
    expect(screen.getByTestId('clipwizard-valid')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'com_clipwizard_next' }));
    expect(store.get(clipWizardStepAtom)).toBe('preview');
  });

  it('shows an empty state without a storyboard', () => {
    mount(<Storyboard config={config} />);
    expect(screen.getByTestId('clipwizard-storyboard-empty')).toBeInTheDocument();
  });
});

describe('ClipWizard render step', () => {
  beforeEach(() => mockStart.mockReset());
  const seed = (store: ReturnType<typeof createStore>) => store.set(clipWizardStoryboardAtom, sb);

  it('starts the render with the settings and then shows the job card', () => {
    mockStart.mockImplementation((_vars, options) => options.onSuccess({ jobId: 'job-9' }));
    const store = mount(<Render />, seed);
    fireEvent.click(screen.getByRole('button', { name: 'com_clipwizard_render_start' }));
    expect(mockStart.mock.calls[0][0]).toMatchObject({
      storyboard: sb,
      settings: { aspectRatio: '9:16' },
    });
    expect(store.get(clipWizardJobIdAtom)).toBe('job-9');
    expect(screen.getByTestId('job-card')).toHaveTextContent('job-9');
  });

  it('says top up when credit is out and keeps the start button for a retry', () => {
    mockStart.mockImplementation((_vars, options) =>
      options.onError({ response: { data: { error: { code: 'insufficient_credit' } } } }),
    );
    mount(<Render />, seed);
    fireEvent.click(screen.getByRole('button', { name: 'com_clipwizard_render_start' }));
    expect(screen.getByTestId('clipwizard-error')).toHaveAttribute(
      'data-code',
      'insufficient_credit',
    );
    expect(screen.getByRole('link', { name: 'com_clipwizard_topup' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'com_clipwizard_retry' })).toBeEnabled();
  });

  it('says the provider failed on a provider error', () => {
    mockStart.mockImplementation((_vars, options) =>
      options.onError({ response: { data: { error: { code: 'provider_failed' } } } }),
    );
    mount(<Render />, seed);
    fireEvent.click(screen.getByRole('button', { name: 'com_clipwizard_render_start' }));
    expect(screen.getByTestId('clipwizard-error')).toHaveTextContent(
      'com_clipwizard_error_provider',
    );
  });
});
