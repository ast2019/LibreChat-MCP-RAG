import { MemoryRouter } from 'react-router-dom';
import { render, screen, within } from '@testing-library/react';
import ToolsDialog from '../ToolsDialog';

let mockRole = 'USER';
let mockStatus: Record<string, unknown>;
jest.mock('~/data-provider', () => ({ useMediaStatusQuery: () => mockStatus }));
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useAuthContext: () => ({ user: { id: 'u', role: mockRole } }),
}));

const ways = [
  { id: 'image', state: 'needs_pack', models: ['google/image'] },
  { id: 'higgsfield_api', state: 'not_configured' },
  { id: 'higgsfield_shared', state: 'owner_not_connected' },
  { id: 'higgsfield_own', state: 'needs_connection' },
];

const renderDialog = () =>
  render(
    <MemoryRouter>
      <ToolsDialog open onOpenChange={() => undefined} />
    </MemoryRouter>,
  );

describe('ToolsDialog', () => {
  it('shows each way with its state and what turns it on', () => {
    mockStatus = { data: { ways }, isLoading: false, isError: false };
    renderDialog();
    const image = screen.getByTestId('media-way-image');
    expect(image).toHaveTextContent('com_media_state_needs_pack');
    expect(within(image).getByRole('link', { name: 'com_ui_balance_buy_pack' })).toHaveAttribute(
      'href',
      '/payment',
    );
    expect(screen.getByTestId('media-way-higgsfield_own')).toHaveTextContent(
      'com_media_how_connect',
    );
    expect(screen.getByTestId('media-way-higgsfield_shared')).toHaveTextContent(
      'com_media_how_owner',
    );
    expect(screen.queryByText('com_media_admin_setup_higgsfield_api')).not.toBeInTheDocument();
  });

  it('tells an admin what to set for a way that is not configured', () => {
    mockRole = 'ADMIN';
    mockStatus = { data: { ways }, isLoading: false, isError: false };
    renderDialog();
    expect(screen.getByText('com_media_admin_setup_higgsfield_api')).toBeInTheDocument();
  });

  it('offers a retry when it cannot load', () => {
    mockStatus = { data: undefined, isLoading: false, isError: true, refetch: jest.fn() };
    renderDialog();
    expect(screen.getByRole('alert')).toHaveTextContent('com_media_tools_error');
    expect(screen.getByRole('button', { name: 'com_ui_retry' })).toBeInTheDocument();
  });
});
