import { Provider } from 'jotai';
import * as Menu from '@ariakit/react/menu';
import userEvent from '@testing-library/user-event';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { INSTALL_DISMISSED_KEY, listenForInstallPrompt, resetInstallState } from '../install';
import { InstallDialog, InstallMenuItem } from '../Install';

function fireInstallPrompt(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  const prompt = jest.fn(() => Promise.resolve());
  Object.assign(event, {
    prompt,
    userChoice: Promise.resolve({ outcome, platform: 'web' }),
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return { event, prompt };
}

function MenuHost({ children }: { children: ReactNode }) {
  return (
    <Menu.MenuProvider open>
      <Menu.Menu>{children}</Menu.Menu>
    </Menu.MenuProvider>
  );
}

function renderEntry(onSelect = jest.fn()) {
  render(
    <Provider>
      <MenuHost>
        <InstallMenuItem onSelect={onSelect} />
      </MenuHost>
    </Provider>,
  );
  return onSelect;
}

const originalUserAgent = navigator.userAgent;

function setUserAgent(value: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value, configurable: true });
}

describe('PWA install entry', () => {
  beforeAll(() => {
    listenForInstallPrompt(window);
  });

  beforeEach(() => {
    localStorage.clear();
    resetInstallState();
    setUserAgent(originalUserAgent);
  });

  afterAll(() => {
    setUserAgent(originalUserAgent);
  });

  it('stays hidden until the browser offers an install prompt', () => {
    renderEntry();
    expect(screen.queryByTestId('nav-install')).not.toBeInTheDocument();

    const { event } = fireInstallPrompt();

    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByTestId('nav-install')).toBeInTheDocument();
  });

  it('opens the dialog from the menu entry', async () => {
    fireInstallPrompt();
    const onSelect = renderEntry();

    await userEvent.click(screen.getByTestId('nav-install'));

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('runs the native prompt from the dialog and hides the entry once installed', async () => {
    const { prompt } = fireInstallPrompt('accepted');
    const onOpenChange = jest.fn();
    render(
      <Provider>
        <MenuHost>
          <InstallMenuItem onSelect={jest.fn()} />
        </MenuHost>
        <InstallDialog open onOpenChange={onOpenChange} />
      </Provider>,
    );

    await userEvent.click(screen.getByTestId('pwa-install-confirm'));

    expect(prompt).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(screen.queryByTestId('nav-install')).not.toBeInTheDocument();
  });

  it('keeps the entry when the user declines the native prompt', async () => {
    fireInstallPrompt('dismissed');
    const onOpenChange = jest.fn();
    render(
      <Provider>
        <InstallDialog open onOpenChange={onOpenChange} />
      </Provider>,
    );

    await userEvent.click(screen.getByTestId('pwa-install-confirm'));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(localStorage.getItem(INSTALL_DISMISSED_KEY)).toBeNull();
  });

  it('remembers "Don\'t show again" across renders', async () => {
    fireInstallPrompt();
    const onOpenChange = jest.fn();
    const { unmount } = render(
      <Provider>
        <InstallDialog open onOpenChange={onOpenChange} />
      </Provider>,
    );

    await userEvent.click(screen.getByTestId('pwa-install-dismiss'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(localStorage.getItem(INSTALL_DISMISSED_KEY)).toBe('true');
    unmount();

    renderEntry();
    expect(screen.queryByTestId('nav-install')).not.toBeInTheDocument();
  });

  it('shows the Add to Home Screen steps on iOS, where there is no prompt', () => {
    setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
    );
    renderEntry();
    expect(screen.getByTestId('nav-install')).toBeInTheDocument();

    render(
      <Provider>
        <InstallDialog open onOpenChange={jest.fn()} />
      </Provider>,
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByTestId('pwa-install-confirm')).not.toBeInTheDocument();
  });

  it('is not offered inside the installed app', () => {
    const matchMedia = window.matchMedia;
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: query === '(display-mode: standalone)',
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }));
    try {
      fireInstallPrompt();
      renderEntry();
      expect(screen.queryByTestId('nav-install')).not.toBeInTheDocument();
    } finally {
      window.matchMedia = matchMedia;
    }
  });
});
