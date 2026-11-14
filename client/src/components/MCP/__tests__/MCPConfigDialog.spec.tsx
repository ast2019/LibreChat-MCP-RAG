import { render, screen } from '@testing-library/react';
import MCPConfigDialog from '../MCPConfigDialog';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, string>) =>
    values ? `${key}:${Object.values(values).join(',')}` : key,
}));
jest.mock('../CustomUserVarsSection', () => ({
  __esModule: true,
  default: () => <div data-testid="vars" />,
}));
jest.mock('../ServerInitializationSection', () => ({
  __esModule: true,
  default: () => <div data-testid="init" />,
}));

const base = {
  isOpen: true,
  onOpenChange: jest.fn(),
  fieldsSchema: { WORDPRESS_SITE_URL: { title: 'آدرس سایت', description: '' } },
  initialValues: {},
  onSave: jest.fn(),
  serverName: 'wordpress',
};

describe('MCP config dialog', () => {
  it('shows the server title and its setup guide above the fields', () => {
    render(
      <MCPConfigDialog
        {...base}
        serverTitle="وردپرس"
        setupHelp={'۱. نصب افزونه\n۲. ساخت رمز برنامه'}
      />,
    );
    expect(screen.getByText(/configure_mcp_variables_for:وردپرس/i)).toBeTruthy();
    const help = screen.getByTestId('mcp-setup-help');
    expect(help.textContent).toBe('۱. نصب افزونه\n۲. ساخت رمز برنامه');
    expect(help.className).toContain('whitespace-pre-line');
  });

  it('shows no guide when the server has none', () => {
    render(<MCPConfigDialog {...base} />);
    expect(screen.queryByTestId('mcp-setup-help')).toBeNull();
    expect(screen.getByText(/configure_mcp_variables_for:wordpress/i)).toBeTruthy();
  });
});
