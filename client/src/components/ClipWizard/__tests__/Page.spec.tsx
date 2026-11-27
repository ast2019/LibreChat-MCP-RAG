import { Provider, createStore } from 'jotai';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import ClipWizard from '../ClipWizard';

let mockQuery: Record<string, unknown>;
jest.mock('~/data-provider', () => ({
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
    mockQuery = { isLoading: false, error: { response: { data: { error: { code: 'not_allowed' } } } } };
    mount();
    expect(screen.getByTestId('clipwizard-error')).toHaveAttribute('data-code', 'not_allowed');
  });

  it('shows the steps and the topic step once the config is there', () => {
    mockQuery = { isLoading: false, data: { enabled: true, voices: [], aspectRatios: [], limits: {} } };
    mount();
    expect(screen.getByTestId('clipwizard-step-topic')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('clipwizard-draft-placeholder')).toBeInTheDocument();
  });
});
