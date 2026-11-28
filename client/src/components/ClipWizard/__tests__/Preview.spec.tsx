import { Provider, createStore } from 'jotai';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  clipWizardPreviewAtom,
  clipWizardStepAtom,
  clipWizardStoryboardAtom,
} from '~/store/clipWizard';
import { wizardConfig } from 'test/clipwizard';
import Preview from '../Preview';

const mockPreview = jest.fn();
jest.mock('~/data-provider', () => ({
  usePreviewClipWizardMutation: () => ({ mutate: mockPreview, isLoading: false }),
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
const result = {
  stills: [
    { frame: 54, mime: 'image/jpeg', base64: 'AAAA' },
    { frame: 144, mime: 'image/jpeg', base64: 'BBBB' },
  ],
  notes: ['image shown as placeholder'],
};

function mount(config = wizardConfig) {
  const store = createStore();
  store.set(clipWizardStoryboardAtom, sb);
  store.set(clipWizardStepAtom, 'preview');
  render(
    <Provider store={store}>
      <MemoryRouter>
        <Preview config={config} />
      </MemoryRouter>
    </Provider>,
  );
  return store;
}

describe('ClipWizard preview step', () => {
  beforeEach(() => mockPreview.mockReset());

  it('asks for the key frames of the storyboard and shows them with the worker notes', () => {
    mockPreview.mockImplementation((_vars, options) => options.onSuccess(result));
    const store = mount();
    expect(screen.queryByTestId('clipwizard-preview-placeholder')).toBeNull();
    fireEvent.click(screen.getByTestId('clipwizard-preview-make'));
    expect(mockPreview).toHaveBeenCalledWith(
      { storyboard: sb, settings: { aspectRatio: '9:16' } },
      expect.any(Object),
    );
    const frames = screen.getAllByRole('img');
    expect(frames).toHaveLength(2);
    expect(frames[0]).toHaveAttribute('src', 'data:image/jpeg;base64,AAAA');
    expect(screen.getByText('image shown as placeholder')).toBeInTheDocument();
    expect(store.get(clipWizardPreviewAtom)?.result).toEqual(result);
    expect(screen.getByTestId('clipwizard-preview-make')).toHaveTextContent(
      'com_clipwizard_preview_again',
    );
  });

  it('shows the stable error text when the preview fails and still lets the user continue', () => {
    mockPreview.mockImplementation((_vars, options) =>
      options.onError({ response: { data: { error: { code: 'busy' } } } }),
    );
    const store = mount();
    fireEvent.click(screen.getByTestId('clipwizard-preview-make'));
    expect(screen.getByTestId('clipwizard-error')).toHaveAttribute('data-code', 'busy');
    fireEvent.click(screen.getByRole('button', { name: 'com_clipwizard_next' }));
    expect(store.get(clipWizardStepAtom)).toBe('render');
  });

  it('says previews are off and offers no button when the site turned them off', () => {
    mount({ ...wizardConfig, preview: false });
    expect(screen.getByTestId('clipwizard-preview-off')).toBeInTheDocument();
    expect(screen.queryByTestId('clipwizard-preview-make')).toBeNull();
  });
});
