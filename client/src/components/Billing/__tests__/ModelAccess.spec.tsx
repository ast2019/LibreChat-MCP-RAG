import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import type { TAdminBillingUser } from 'librechat-data-provider';
import ModelAccess from '../ModelAccess';

const mockMutate = jest.fn();
const mockShowToast = jest.fn();

/** Renders keys, not copy: these assertions name the localization key each string uses. */
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

jest.mock('~/data-provider', () => ({
  useAdminUserModelAccessMutation: () => ({ mutate: mockMutate, isLoading: false }),
}));

const user: TAdminBillingUser = {
  id: 'u1',
  name: 'Sara',
  username: 'sara',
  email: 'sara@example.com',
  role: 'USER',
  balance: null,
  usedPercent: null,
};

/** Options render in this order: follow the role, allow, deny */
const ROLE = 0;
const ALLOW = 1;
const DENY = 2;

async function choose(key: 'local' | 'private', index: number) {
  await userEvent.click(screen.getByTestId(`model-access-${key}-u1`));
  const options = await screen.findAllByRole('option');
  await userEvent.click(options[index]);
}

describe('ModelAccess', () => {
  beforeEach(() => {
    mockMutate.mockReset();
    mockShowToast.mockReset();
  });

  it('sends an allow for the local class and a deny for the private class', async () => {
    render(<ModelAccess user={user} />);

    await choose('local', ALLOW);
    expect(mockMutate).toHaveBeenLastCalledWith({ userId: 'u1', local: true }, expect.any(Object));

    await choose('private', DENY);
    expect(mockMutate).toHaveBeenLastCalledWith(
      { userId: 'u1', private: false },
      expect.any(Object),
    );
  });

  it('returns a user to the role with null, and skips a choice that changes nothing', async () => {
    render(<ModelAccess user={{ ...user, modelAccess: { local: false } }} />);

    await choose('local', DENY);
    expect(mockMutate).not.toHaveBeenCalled();

    await choose('local', ROLE);
    expect(mockMutate).toHaveBeenCalledWith({ userId: 'u1', local: null }, expect.any(Object));
  });

  it('confirms success with a toast', async () => {
    mockMutate.mockImplementation((_vars, options) => options.onSuccess());
    render(<ModelAccess user={user} />);

    await choose('private', ALLOW);
    expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ status: 'success' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an inline error and a toast when saving fails', async () => {
    mockMutate.mockImplementation((_vars, options) => options.onError());
    render(<ModelAccess user={user} />);

    await choose('local', DENY);
    expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('explains instead of offering a choice for admins', () => {
    render(<ModelAccess user={{ ...user, role: 'ADMIN' }} />);

    expect(screen.queryByTestId('model-access-local-u1')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
