import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import type { TAdminBillingUser } from 'librechat-data-provider';
import AccessControl from '../AccessControl';

const mockModelMutate = jest.fn();
const mockApiMutate = jest.fn();
const mockMediaMutate = jest.fn();
const mockShowToast = jest.fn();

/** Renders keys with their values, so assertions name the key and what fills it. */
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}(${Object.values(values).join('|')})` : key,
}));

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

jest.mock('~/data-provider', () => ({
  useAdminUserModelAccessMutation: () => ({ mutate: mockModelMutate, isLoading: false }),
  useAdminUserApiAccessMutation: () => ({ mutate: mockApiMutate, isLoading: false }),
  useAdminUserMediaAccessMutation: () => ({ mutate: mockMediaMutate, isLoading: false }),
}));

const packs = [{ id: 'pro', label: 'Pro', credits: 1, grants: { media: true } }];

const user: TAdminBillingUser = {
  id: 'u1',
  name: 'Sara',
  username: 'sara',
  email: 'sara@example.com',
  role: 'USER',
  packId: 'pro',
  balance: { tokenCredits: 1, packId: 'pro', packLabel: 'Pro' },
  usedPercent: 0,
  effective: {
    local: { allowed: false, source: 'role' },
    private: { allowed: true, source: 'role' },
    media: { allowed: true, source: 'pack' },
    api: { allowed: false, source: 'role' },
  },
};

/** Options render in this order: default, allow, deny */
const DEFAULT = 0;
const ALLOW = 1;
const DENY = 2;

async function choose(testId: string, index: number) {
  await userEvent.click(screen.getByTestId(testId));
  const options = await screen.findAllByRole('option');
  await userEvent.click(options[index]);
}

describe('AccessControl', () => {
  beforeEach(() => {
    mockModelMutate.mockReset();
    mockApiMutate.mockReset();
    mockMediaMutate.mockReset();
    mockShowToast.mockReset();
  });

  it('says what the default means now and who decides it', () => {
    render(<AccessControl user={user} field="media" packs={packs} />);
    expect(screen.getByTestId('media-access-u1')).toHaveTextContent(
      'com_admin_access_default_now(com_admin_model_access_allow)',
    );
    expect(
      screen.getByText(
        'com_admin_access_now(com_admin_model_access_allow|com_admin_access_source_pack(Pro))',
      ),
    ).toBeInTheDocument();
  });

  it('sends each class through its own switch', async () => {
    const { unmount } = render(<AccessControl user={user} field="local" packs={packs} />);
    await choose('model-access-local-u1', ALLOW);
    expect(mockModelMutate).toHaveBeenCalledWith({ userId: 'u1', local: true }, expect.any(Object));
    unmount();

    render(<AccessControl user={user} field="api" packs={packs} />);
    await choose('api-access-u1', DENY);
    expect(mockApiMutate).toHaveBeenCalledWith(
      { userId: 'u1', apiAccess: false },
      expect.any(Object),
    );
  });

  it('returns a user to the default with null, and skips a choice that changes nothing', async () => {
    render(
      <AccessControl
        user={{
          ...user,
          mediaAccess: false,
          effective: { ...user.effective!, media: { allowed: false, source: 'user' } },
        }}
        field="media"
        packs={packs}
      />,
    );
    await choose('media-access-u1', DENY);
    expect(mockMediaMutate).not.toHaveBeenCalled();
    await choose('media-access-u1', DEFAULT);
    expect(mockMediaMutate).toHaveBeenCalledWith(
      { userId: 'u1', mediaAccess: null },
      expect.any(Object),
    );
  });

  it('shows an inline error and a toast when saving fails', async () => {
    mockApiMutate.mockImplementation((_vars, options) => options.onError());
    render(<AccessControl user={user} field="api" packs={packs} />);
    await choose('api-access-u1', ALLOW);
    expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('explains instead of offering a choice of model classes for admins', () => {
    render(<AccessControl user={{ ...user, role: 'ADMIN' }} field="private" packs={packs} />);
    expect(screen.queryByTestId('model-access-private-u1')).not.toBeInTheDocument();
    expect(screen.getByText('com_admin_access_source_admin')).toBeInTheDocument();
  });
});
