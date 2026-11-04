import userEvent from '@testing-library/user-event';
import { act, render, screen } from '@testing-library/react';
import type { RegisterSWOptions } from 'vite-plugin-pwa/types';
import UpdatePrompt from '../Update';

const mockUpdateServiceWorker = jest.fn((_reload?: boolean) => Promise.resolve());
const mockRefetch = jest.fn(() => Promise.resolve({}));
const mockRegister: { options?: RegisterSWOptions; needRefresh: boolean } = {
  needRefresh: true,
};
const mockStartup: { appVersion?: string; changelog: { version: string; highlights: string[] }[] } =
  {
    appVersion: '0.37.0',
    changelog: [{ version: '0.37.0', highlights: ['Code Interpreter on login'] }],
  };

jest.mock('virtual:pwa-register/react', () => {
  const { useState } = jest.requireActual<typeof import('react')>('react');
  return {
    useRegisterSW: (options?: RegisterSWOptions) => {
      mockRegister.options = options;
      const needRefresh = useState(mockRegister.needRefresh);
      const offlineReady = useState(false);
      return { needRefresh, offlineReady, updateServiceWorker: mockUpdateServiceWorker };
    },
  };
});

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({
    data: mockStartup,
    refetch: mockRefetch,
  }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, string>) =>
    vars?.[0] != null ? `${key}:${vars[0]}` : key,
}));

describe('UpdatePrompt', () => {
  beforeEach(() => {
    mockRegister.needRefresh = true;
    mockRegister.options = undefined;
    mockStartup.appVersion = '0.37.0';
    mockStartup.changelog = [{ version: '0.37.0', highlights: ['Code Interpreter on login'] }];
    mockUpdateServiceWorker.mockClear();
    mockRefetch.mockClear();
  });

  it('renders nothing while no new worker is waiting', () => {
    mockRegister.needRefresh = false;
    render(<UpdatePrompt />);
    expect(screen.queryByTestId('pwa-update-banner')).not.toBeInTheDocument();
  });

  it('announces a waiting worker with the version and activates it on request', async () => {
    render(<UpdatePrompt />);

    const banner = screen.getByTestId('pwa-update-banner');
    expect(banner).toHaveAttribute('role', 'status');
    expect(banner).toHaveTextContent('com_pwa_update_ready_version:0.37.0');
    expect(screen.getByTestId('pwa-update-notes')).toHaveTextContent('Code Interpreter on login');

    await userEvent.click(screen.getByTestId('pwa-update-action'));

    expect(mockUpdateServiceWorker).toHaveBeenCalledWith(true);
    expect(screen.getByTestId('pwa-update-action')).toBeDisabled();
  });

  it('does not announce the missing-file placeholder 0.0.0', () => {
    mockStartup.appVersion = '0.0.0';
    render(<UpdatePrompt />);

    const banner = screen.getByTestId('pwa-update-banner');
    expect(banner).toHaveTextContent('com_pwa_update_ready');
    expect(banner).not.toHaveTextContent('0.0.0');
    expect(banner).not.toHaveTextContent('com_pwa_update_ready_version');
  });

  it('can be closed without updating', async () => {
    render(<UpdatePrompt />);

    await userEvent.click(screen.getByTestId('pwa-update-close'));

    expect(screen.queryByTestId('pwa-update-banner')).not.toBeInTheDocument();
    expect(mockUpdateServiceWorker).not.toHaveBeenCalled();
  });

  it('checks for a newer worker when the app returns to the foreground', () => {
    mockRegister.needRefresh = false;
    render(<UpdatePrompt />);
    const update = jest.fn(() => Promise.resolve());
    const registration = { installing: null, update } as unknown as ServiceWorkerRegistration;

    act(() => {
      mockRegister.options?.onRegisteredSW?.('sw.js', registration);
    });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(update).toHaveBeenCalledTimes(1);
  });
});
