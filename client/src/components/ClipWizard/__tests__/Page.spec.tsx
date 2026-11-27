import { Provider, createStore } from 'jotai';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { wizardConfig } from 'test/clipwizard';
import ClipWizard from '../ClipWizard';

let mockQuery: Record<string, unknown>;
jest.mock('@librechat/client', () =>
  jest.requireActual<typeof import('test/clipwizard')>('test/clipwizard').withNativeDropdown(),
);
jest.mock('~/data-provider', () => ({
  useDraftClipWizardMutation: () => ({ mutate: jest.fn(), isLoading: false }),
  useChatClipWizardMutation: () => ({ mutate: jest.fn(), isLoading: false }),
  useClipWizardConfigQuery: () => mockQuery,
}));
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

const mount = () =>
  render(
    <Provider store={createStore()}>
      <MemoryRouter>
        <ClipWizard />
      </MemoryRouter>
    </Provider>,
  );

describe('ClipWizard page', () => {
  it('shows a loading state', () => {
    mockQuery = { isLoading: true };
    mount();
    expect(screen.getByTestId('clipwizard-loading')).toBeInTheDocument();
  });

  it('shows the stable refusal when the user has no access', () => {
    mockQuery = {
      isLoading: false,
      error: { response: { data: { error: { code: 'not_allowed' } } } },
    };
    mount();
    expect(screen.getByTestId('clipwizard-error')).toHaveAttribute('data-code', 'not_allowed');
  });

  it('shows the steps and the topic step once the config is there', () => {
    mockQuery = { isLoading: false, data: wizardConfig };
    mount();
    expect(screen.getByTestId('clipwizard-step-topic')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('button', { name: 'com_clipwizard_draft_write' })).toBeInTheDocument();
    expect(screen.getByLabelText('com_clipwizard_chat_label')).toBeInTheDocument();
  });
});
