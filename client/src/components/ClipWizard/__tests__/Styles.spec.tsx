import { Provider, createStore } from 'jotai';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { clipWizardImagesAtom, clipWizardStoryboardAtom } from '~/store/clipWizard';
import { wizardConfig } from 'test/clipwizard';
import Storyboard from '../Storyboard';
import Settings from '../Settings';

const mockSample = jest.fn();
jest.mock('@librechat/client', () =>
  jest.requireActual<typeof import('test/clipwizard')>('test/clipwizard').withNativeDropdown(),
);
jest.mock('~/data-provider', () => ({
  useClipVoiceSampleMutation: () => ({ mutate: jest.fn() }),
  useClipStyleSampleQuery: (payload: { kind: string; id: string }) => mockSample(payload),
  useEstimateClipWizardMutation: () => ({ mutate: jest.fn(), isLoading: false }),
  useValidateClipStoryboardMutation: () => ({ mutate: jest.fn(), isLoading: false }),
  useDraftClipWizardMutation: () => ({ mutate: jest.fn() }),
  useChatClipWizardMutation: () => ({ mutate: jest.fn() }),
}));
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

const config = {
  ...wizardConfig,
  themes: [
    { id: 'midnight', label: 'Midnight' },
    { id: 'neon', label: 'Neon' },
  ],
};
const picture = (id: string) => ({
  data: { kind: 'theme', id, mime: 'image/jpeg', base64: `IMG-${id}`, cached: true },
  isLoading: false,
});

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

describe('built-in style samples', () => {
  beforeEach(() => {
    mockSample.mockReset();
    mockSample.mockImplementation(({ kind, id }: { kind: string; id: string }) =>
      kind === 'theme' ? picture(id) : { data: undefined, isLoading: false },
    );
  });

  it('shows a real sample picture for every built-in style in the ready styles section', () => {
    mount(<Settings config={config} />);
    const gallery = screen.getByTestId('clipwizard-style-samples');
    const images = gallery.querySelectorAll('img');
    expect(images).toHaveLength(2);
    expect(images[1]).toHaveAttribute('src', 'data:image/jpeg;base64,IMG-neon');
    expect(mockSample).toHaveBeenCalledWith({ kind: 'theme', id: 'midnight' });
    expect(mockSample).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'image' }));
  });

  it('keeps the name visible while a sample is still being made or could not be made', () => {
    mockSample.mockImplementation(() => ({ data: undefined, isLoading: false }));
    mount(<Settings config={config} />);
    expect(screen.getByText('Neon')).toBeInTheDocument();
    expect(screen.getByTestId('clipwizard-style-empty-neon')).toHaveTextContent(
      'com_clipwizard_style_sample_none',
    );
  });

  it('shows an AI image model sample only when the server says one exists', () => {
    const withSample = {
      ...config,
      imageModels: [
        {
          id: 'img-a',
          label: 'Image A',
          source: 'openrouter' as const,
          credits: 7,
          hasSample: true,
        },
      ],
    };
    mount(<Settings config={withSample} />, (store) =>
      store.set(clipWizardImagesAtom, { source: 'openrouter', modelId: 'img-a' }),
    );
    expect(mockSample).toHaveBeenCalledWith({ kind: 'image', id: 'img-a' });
    expect(screen.queryByTestId('clipwizard-style-samples')).toBeNull();
  });

  it('does not ask for an AI image sample when none exists', () => {
    mount(<Settings config={config} />, (store) =>
      store.set(clipWizardImagesAtom, { source: 'openrouter', modelId: 'img-a' }),
    );
    expect(mockSample).not.toHaveBeenCalled();
  });

  it('lets the storyboard theme picker choose a style from its sample', () => {
    const store = mount(<Storyboard config={config} />, (s) =>
      s.set(clipWizardStoryboardAtom, {
        title: 't',
        theme: 'midnight',
        scenes: [{ type: 'hook', narration: 'a' }],
      }),
    );
    expect(screen.getByTestId('clipwizard-style-midnight')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('clipwizard-style-neon'));
    expect(store.get(clipWizardStoryboardAtom)?.theme).toBe('neon');
    expect(screen.getByTestId('clipwizard-style-neon')).toHaveAttribute('aria-pressed', 'true');
  });
});
