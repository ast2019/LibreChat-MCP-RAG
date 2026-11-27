import { Provider, createStore } from 'jotai';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { clipWizardImagesAtom } from '~/store/clipWizard';
import { wizardConfig } from 'test/clipwizard';
import Settings from '../Settings';

jest.mock('@librechat/client', () =>
  jest.requireActual<typeof import('test/clipwizard')>('test/clipwizard').withNativeDropdown(),
);
jest.mock('~/data-provider', () => ({
  useClipVoiceSampleMutation: () => ({ mutate: jest.fn() }),
}));
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

const higgs = { id: 'hf-1', label: 'Higgs One', source: 'higgsfield' as const, credits: 30 };

function mount(config = wizardConfig) {
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

describe('ClipWizard image settings', () => {
  it('hides every Higgsfield control when it is not connected', () => {
    mount({
      ...wizardConfig,
      imageModels: [...wizardConfig.imageModels, higgs],
      imageSources: { ...wizardConfig.imageSources, higgsfield: false },
    });
    expect(screen.queryByRole('button', { name: 'com_clipwizard_images_higgsfield' })).toBeNull();
    expect(screen.getByRole('button', { name: 'com_clipwizard_images_ai' })).toBeInTheDocument();
  });

  it('offers Higgsfield and its models when the server says it is connected', () => {
    const store = mount({
      ...wizardConfig,
      imageModels: [...wizardConfig.imageModels, higgs],
      imageSources: { ...wizardConfig.imageSources, higgsfield: true },
    });
    fireEvent.click(screen.getByRole('button', { name: 'com_clipwizard_images_higgsfield' }));
    expect(store.get(clipWizardImagesAtom)).toEqual({ source: 'higgsfield', modelId: 'hf-1' });
    expect(screen.getByRole('option', { name: 'Higgs One' })).toBeInTheDocument();
    expect(screen.getByTestId('clipwizard-image-credits')).toHaveTextContent('30');
  });

  it('defaults to built-in styles and shows no image model there', () => {
    const store = mount();
    expect(store.get(clipWizardImagesAtom)).toEqual({ source: 'builtin' });
    expect(screen.queryByTestId('clipwizard-image-model')).toBeNull();
  });

  it('shows the credit estimate per image and bounds the cap by the config', () => {
    const store = mount();
    fireEvent.click(screen.getByRole('button', { name: 'com_clipwizard_images_ai' }));
    expect(screen.getByTestId('clipwizard-image-credits')).toHaveTextContent('7');
    const cap = screen.getByLabelText(/com_clipwizard_images_cap_max/);
    expect(cap).toHaveAttribute('max', '50');
    fireEvent.change(cap, { target: { value: '500' } });
    expect(store.get(clipWizardImagesAtom)).toEqual({
      source: 'openrouter',
      modelId: 'img-a',
      maxCredits: 50,
    });
    fireEvent.change(cap, { target: { value: '' } });
    expect(store.get(clipWizardImagesAtom)).toEqual({ source: 'openrouter', modelId: 'img-a' });
  });

  it('does not offer AI images when the server has them off', () => {
    mount({
      ...wizardConfig,
      imageSources: { ...wizardConfig.imageSources, ai: false },
      imageModels: [],
    });
    expect(screen.queryByRole('button', { name: 'com_clipwizard_images_ai' })).toBeNull();
  });
});
