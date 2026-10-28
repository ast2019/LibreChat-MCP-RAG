import userEvent from '@testing-library/user-event';
import { act, render, screen } from '@testing-library/react';
import type { RegisterSWOptions } from 'vite-plugin-pwa/types';
import UpdatePrompt from '../Update';

const mockUpdateServiceWorker = jest.fn((_reload?: boolean) => Promise.resolve());
const mockRegister: { options?: RegisterSWOptions; needRefresh: boolean } = {
  needRefresh: true,
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

describe('UpdatePrompt', () => {
  beforeEach(() => {
    mockRegister.needRefresh = true;
    mockRegister.options = undefined;
    mockUpdateServiceWorker.mockClear();
  });

  it('renders nothing while no new worker is waiting', () => {
    mockRegister.needRefresh = false;
    render(<UpdatePrompt />);
    expect(screen.queryByTestId('pwa-update-banner')).not.toBeInTheDocument();
  });

  it('announces a waiting worker and activates it on request', async () => {
    render(<UpdatePrompt />);

    const banner = screen.getByTestId('pwa-update-banner');
    expect(banner).toHaveAttribute('role', 'status');

    await userEvent.click(screen.getByTestId('pwa-update-action'));

    expect(mockUpdateServiceWorker).toHaveBeenCalledWith(true);
    expect(screen.getByTestId('pwa-update-action')).toBeDisabled();
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
