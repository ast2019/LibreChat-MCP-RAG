import { useState } from 'react';
import { RecoilRoot } from 'recoil';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from '@testing-library/react';
import { MyFilesModal } from './MyFilesModal';

jest.mock('~/data-provider', () => ({
  useGetFiles: () => ({ data: [], isLoading: false, isError: false, refetch: jest.fn() }),
  isDirectDownloadSource: () => false,
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useAuthContext: () => ({ user: { id: 'user' } }),
}));

jest.mock('~/hooks/Files', () => ({
  useDeleteFilesFromTable: () => ({ deleteFiles: jest.fn() }),
}));

jest.mock('~/components/Chat/Input/Composer/Files', () => ({
  isImage: () => false,
  isDocument: () => true,
  previewOf: () => null,
  FilePreviewer: () => null,
}));

jest.mock('./Library/FileCard', () => ({
  __esModule: true,
  default: () => <div data-testid="file-card" />,
  FileCardSkeletons: () => null,
}));

function Harness({ trigger }: { trigger: HTMLElement }) {
  const [open, setOpen] = useState(true);
  return (
    <RecoilRoot>
      <MyFilesModal open={open} onOpenChange={setOpen} triggerRef={{ current: trigger }} />
    </RecoilRoot>
  );
}

describe('MyFilesModal focus restoration', () => {
  it('returns focus to the shortcut invoker instead of the account button', async () => {
    const user = userEvent.setup();
    const invoker = document.createElement('button');
    const inertSidebar = document.createElement('div');
    const accountButton = document.createElement('button');
    inertSidebar.setAttribute('inert', '');
    inertSidebar.append(accountButton);
    document.body.append(invoker, inertSidebar);
    invoker.focus();

    render(<Harness trigger={accountButton} />);
    await user.click(await screen.findByRole('button', { name: 'Close' }));

    await waitFor(() => expect(invoker).toHaveFocus());
  });

  it('falls back to the account button when the dialog opens from its menu', async () => {
    const user = userEvent.setup();
    const menu = document.createElement('div');
    const menuItem = document.createElement('button');
    const accountButton = document.createElement('button');
    menu.setAttribute('role', 'menu');
    menu.append(menuItem);
    document.body.append(menu, accountButton);
    menuItem.focus();

    render(<Harness trigger={accountButton} />);
    await user.click(await screen.findByRole('button', { name: 'Close' }));

    await waitFor(() => expect(accountButton).toHaveFocus());
  });
});
