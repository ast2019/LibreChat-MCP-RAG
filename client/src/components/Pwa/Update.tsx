import { useState } from 'react';
import { Button } from '@librechat/client';
import { RefreshCw, X } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useLocalize } from '~/hooks';

/** How often an open tab asks the server for a newer worker. */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

function watchForUpdates(registration: ServiceWorkerRegistration) {
  const check = () => {
    if (registration.installing || !navigator.onLine) {
      return;
    }
    registration.update().catch(() => {
      /* Offline or the server is restarting: the next check retries. */
    });
  };
  window.setInterval(check, UPDATE_CHECK_INTERVAL_MS);
  /** A PWA left in the background for days resumes here, not with a page load. */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      check();
    }
  });
}

export function UpdateBanner({
  onUpdate,
  onDismiss,
  updating = false,
}: {
  onUpdate: () => void;
  onDismiss: () => void;
  updating?: boolean;
}) {
  const localize = useLocalize();
  return (
    <div className="pt-safe pointer-events-none fixed inset-x-0 top-0 z-[999] flex justify-center px-3">
      <div
        role="status"
        aria-live="polite"
        data-testid="pwa-update-banner"
        className="bg-surface-dialog text-text-primary border-border-light pointer-events-auto mt-2 flex w-full max-w-md items-center gap-2 rounded-xl border p-2 ps-3 text-sm shadow-lg"
      >
        <RefreshCw className="icon-md text-text-secondary shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">{localize('com_pwa_update_ready')}</span>
        <Button size="sm" onClick={onUpdate} disabled={updating} data-testid="pwa-update-action">
          {localize('com_pwa_update_action')}
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onDismiss}
          aria-label={localize('com_ui_close')}
          data-testid="pwa-update-close"
          className="min-h-10 min-w-10"
        >
          <X className="icon-sm" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

/**
 * Registers the service worker. A new build installs in the background and waits; this asks
 * before activating it, since activation reloads the page and drops an unsent draft or a
 * response that is still streaming.
 */
export default function UpdatePrompt() {
  const [updating, setUpdating] = useState(false);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (registration) {
        watchForUpdates(registration);
      }
    },
  });

  if (!needRefresh) {
    return null;
  }

  return (
    <UpdateBanner
      updating={updating}
      onDismiss={() => setNeedRefresh(false)}
      onUpdate={() => {
        setUpdating(true);
        /** Tells the waiting worker to skip waiting; the page reloads once it takes control. */
        updateServiceWorker(true).catch(() => setUpdating(false));
      }}
    />
  );
}
