import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import PasswordDialog from '../PasswordDialog';

const mockMutate = jest.fn();
const mockShowToast = jest.fn();

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));
jest.mock('~/data-provider', () => ({
  useAdminSetUserPasswordMutation: () => ({ mutate: mockMutate, isLoading: false }),
}));
jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

const user = { id: 'u1', name: 'Ali', email: 'ali@x.io', role: 'USER', balance: null } as never;

describe('admin password dialog', () => {
  beforeEach(() => mockMutate.mockReset());

  it('sends the password only when it is long enough and typed twice the same', async () => {
    render(<PasswordDialog user={user} onClose={jest.fn()} />);
    const save = screen.getByText('com_admin_password_save').closest('button')!;
    await userEvent.type(screen.getByTestId('admin-new-password'), 'short');
    expect(screen.getByText('com_admin_password_invalid')).toBeTruthy();
    expect(save.disabled).toBe(true);

    await userEvent.clear(screen.getByTestId('admin-new-password'));
    await userEvent.type(screen.getByTestId('admin-new-password'), 'New-pass-123');
    await userEvent.type(screen.getByTestId('admin-confirm-password'), 'New-pass-12');
    expect(screen.getByText('com_auth_password_not_match')).toBeTruthy();
    expect(save.disabled).toBe(true);

    await userEvent.type(screen.getByTestId('admin-confirm-password'), '3');
    expect(save.disabled).toBe(false);
    await userEvent.click(save);
    expect(mockMutate).toHaveBeenCalledWith(
      { userId: 'u1', password: 'New-pass-123' },
      expect.any(Object),
    );
  });
});
