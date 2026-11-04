import { render, screen } from '@testing-library/react';
import Guide from '../Guide';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, params?: Record<string, string>) =>
    params?.[0] != null ? `${key}:${params[0]}` : key,
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({
    data: {
      modelSpecs: {
        list: [
          { name: 'local', label: 'لوکال', privacy: 'local' },
          { name: 'smart', label: 'Smart' },
        ],
      },
    },
  }),
}));

describe('API Guide', () => {
  it('gives the base URL, groups models, and shows how to call local models', () => {
    render(<Guide />);
    const baseURL = `${window.location.origin}/api/agents/v1`;
    expect(screen.getAllByText((text) => text.includes(baseURL)).length).toBeGreaterThan(0);
    expect(screen.getByText('local')).toBeInTheDocument();
    expect(screen.getByText('smart')).toBeInTheDocument();
    expect(screen.getByText('com_api_guide_models_local')).toBeInTheDocument();
    expect(screen.getByText('com_api_guide_local_title')).toBeInTheDocument();
    expect(screen.getByText('com_api_guide_local_example:local')).toBeInTheDocument();
    const config = screen.getByText((text) => text.includes('capabilities: [tool_use]'));
    expect(config).toHaveTextContent(`apiBase: ${baseURL}`);
    expect(config).toHaveTextContent('model: local');
    expect(screen.getByRole('link', { name: '/api/docs' })).toHaveAttribute('href', '/api/docs');
    expect(screen.getByText('com_api_guide_tools')).toBeInTheDocument();
  });
});
