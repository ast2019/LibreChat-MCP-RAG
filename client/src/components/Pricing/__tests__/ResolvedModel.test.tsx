import { render, screen } from '@testing-library/react';
import ResolvedModel, { getResolvedModel } from '../ResolvedModel';

describe('getResolvedModel', () => {
  it('reads a saved resolved model and ignores anything else', () => {
    expect(getResolvedModel({ metadata: { resolvedModel: 'openai/gpt-6.1-sol' } })).toBe(
      'openai/gpt-6.1-sol',
    );
    expect(getResolvedModel({ metadata: { resolvedModel: 42 } })).toBeUndefined();
    expect(getResolvedModel({})).toBeUndefined();
    expect(getResolvedModel(null)).toBeUndefined();
  });
});

describe('ResolvedModel', () => {
  it('shows the readable name with the raw id as its title', () => {
    render(<ResolvedModel id="anthropic/claude-sonnet-5.5" />);
    const label = screen.getByTestId('resolved-model');
    expect(label).toHaveAttribute('title', 'anthropic/claude-sonnet-5.5');
    expect(label).toHaveTextContent('Claude Sonnet 5.5');
  });
});
