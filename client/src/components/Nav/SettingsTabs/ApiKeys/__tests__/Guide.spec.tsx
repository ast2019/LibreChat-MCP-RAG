import { render, screen } from '@testing-library/react';
import Guide from '../Guide';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({
    data: { modelSpecs: { list: [{ name: 'smart', label: 'Smart' }] } },
  }),
}));

describe('API Guide', () => {
  it('gives the base URL, the model names, a VS Code config and the reference link', () => {
    render(<Guide />);
    const baseURL = `${window.location.origin}/api/agents/v1`;
    expect(screen.getAllByText((text) => text.includes(baseURL)).length).toBeGreaterThan(0);
    expect(screen.getByText('smart')).toBeInTheDocument();
    const config = screen.getByText((text) => text.includes('capabilities: [tool_use]'));
    expect(config).toHaveTextContent(`apiBase: ${baseURL}`);
    expect(config).toHaveTextContent('model: smart');
    expect(screen.getByRole('link', { name: '/api/docs' })).toHaveAttribute('href', '/api/docs');
    expect(screen.getByText('com_api_guide_tools')).toBeInTheDocument();
  });
});
