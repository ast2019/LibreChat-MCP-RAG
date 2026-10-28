import { useSyncExternalStore } from 'react';

/** Chromium's install event; not in lib.dom because it is not standardized. */
export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

/** `native`: the browser offered an install prompt. `ios`: Safari installs only through
 *  Share → Add to Home Screen, so the app shows the steps instead. */
export type InstallMode = 'native' | 'ios' | null;

export const INSTALL_DISMISSED_KEY = 'pwaInstallDismissed';

let deferred: InstallPromptEvent | null = null;
let installed = false;
let listening = false;
const subscribers = new Set<() => void>();

function notify() {
  subscribers.forEach((callback) => callback());
}

/**
 * `beforeinstallprompt` fires once, early, often before any menu mounts, so the event is
 * captured from startup and held here until the user asks to install.
 */
export function listenForInstallPrompt(target: Window = window) {
  if (listening) {
    return;
  }
  listening = true;
  target.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    notify();
  });
  target.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    notify();
  });
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const nav = window.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) {
    return true;
  }
  return ['(display-mode: standalone)', '(display-mode: window-controls-overlay)'].some(
    (query) => window.matchMedia?.(query).matches === true,
  );
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
    return true;
  }
  /** iPadOS 13+ reports itself as a Mac; touch points tell them apart. */
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

function getMode(): InstallMode {
  if (installed || isStandalone()) {
    return null;
  }
  if (deferred) {
    return 'native';
  }
  return isIOS() ? 'ios' : null;
}

function subscribe(callback: () => void) {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

/** Shows the browser's install prompt; resolves with the user's choice. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferred;
  if (!event) {
    return 'unavailable';
  }
  /** A prompt event can be used only once. */
  deferred = null;
  await event.prompt();
  const { outcome } = await event.userChoice;
  if (outcome === 'accepted') {
    installed = true;
  }
  notify();
  return outcome;
}

export function useInstallMode(): InstallMode {
  return useSyncExternalStore(subscribe, getMode, () => null);
}

/** Test-only: forget captured state between cases. */
export function resetInstallState() {
  deferred = null;
  installed = false;
  notify();
}
