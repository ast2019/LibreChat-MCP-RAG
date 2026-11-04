import { useEffect, useMemo, useState } from 'react';
import { Button } from '@librechat/client';
import { RefreshCw, X } from 'lucide-react';
import { Constants } from 'librechat-data-provider';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useGetStartupConfig } from '~/data-provider';
import { useLocalize } from '~/hooks';

/** How often an open tab asks the server for a newer worker. */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** Placeholder / unset versions must not appear in the banner («نسخهٔ 0.0.0»). */
function displayableVersion(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === '0.0.0' || trimmed.includes('__HIVEGPT_VERSION__')) {
    return undefined;
  }
  return trimmed;
}

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
  version,
  highlights = [],
}: {
  onUpdate: () => void;
  onDismiss: () => void;
  updating?: boolean;
  version?: string;
  highlights?: string[];
}) {
  const localize = useLocalize();
  const message = version
    ? localize('com_pwa_update_ready_version', { 0: version })
    : localize('com_pwa_update_ready');

  return (
    <div className="pt-safe pointer-events-none fixed inset-x-0 top-0 z-[999] flex justify-center px-3">
      <div
        role="status"
        aria-live="polite"
        data-testid="pwa-update-banner"
        className="bg-surface-dialog text-text-primary border-border-light pointer-events-auto mt-2 flex w-full max-w-md flex-col gap-2 rounded-xl border p-2 ps-3 text-sm shadow-lg"
      >
        <div className="flex items-center gap-2">
          <RefreshCw className="icon-md text-text-secondary shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{message}</span>
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
        {highlights.length > 0 && (
          <div className="border-border-light border-t pt-2 pe-2 pb-1" data-testid="pwa-update-notes">
            <p className="text-text-secondary mb-1 text-xs font-medium">
              {localize('com_pwa_update_whats_new')}
            </p>
            <ul className="text-text-secondary list-disc space-y-0.5 ps-4 text-xs">
              {highlights.slice(0, 4).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}
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
  const { data: startupConfig, refetch } = useGetStartupConfig();
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

  /** When a new worker is waiting, refresh config so the banner can name the new VERSION. */
  useEffect(() => {
    if (needRefresh) {
      void refetch();
    }
  }, [needRefresh, refetch]);

  const version = displayableVersion(startupConfig?.appVersion ?? Constants.APP_VERSION);
  const highlights = useMemo(() => {
    const changelog = startupConfig?.changelog ?? [];
    const entry = version ? changelog.find((item) => item.version === version) : undefined;
    const fallback = changelog.find((item) => displayableVersion(item.version));
    return entry?.highlights ?? fallback?.highlights ?? [];
  }, [startupConfig?.changelog, version]);

  if (!needRefresh) {
    return null;
  }

  return (
    <UpdateBanner
      updating={updating}
      version={version}
      highlights={highlights}
      onDismiss={() => setNeedRefresh(false)}
      onUpdate={() => {
        setUpdating(true);
        /** Tells the waiting worker to skip waiting; the page reloads once it takes control. */
        updateServiceWorker(true).catch(() => setUpdating(false));
      }}
    />
  );
}
