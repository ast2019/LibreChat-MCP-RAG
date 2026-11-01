import { chromium } from 'playwright-core';
import { createEgressProxy } from './egress.mjs';

const LAUNCH_TIMEOUT_MS = 30_000;
const VIEWPORT = Object.freeze({ width: 1280, height: 800 });

/* QUIC and WebRTC send UDP that no HTTP proxy carries, so they would bypass the egress check. */
const ARGS = [
  '--disable-quic',
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--disable-dev-shm-usage',
  '--disable-background-networking',
  '--disable-sync',
  '--no-first-run',
  '--lang=fa-IR',
];

/**
 * The live view's frames: a CDP screencast of the active tab while anyone watches. Chromium
 * sends a frame when the page repaints; each is acknowledged at once so the next one comes, and
 * subscribers decide how many to forward.
 */
function createScreencast({ context, viewport, page }) {
  const listeners = new Map();
  let cdp = null;
  let castPage = null;
  let latest = null;
  let switching = Promise.resolve();

  async function stopCast() {
    const session = cdp;
    cdp = null;
    castPage = null;
    if (session) {
      await session.send('Page.stopScreencast').catch(() => {});
      await session.detach().catch(() => {});
    }
  }

  async function startCast() {
    const target = page();
    if (listeners.size === 0 || !target || target === castPage) {
      return;
    }
    await stopCast();
    const quality = Math.max(...listeners.values());
    const session = await context.newCDPSession(target);
    cdp = session;
    castPage = target;
    session.on('Page.screencastFrame', (frame) => {
      session.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
      if (cdp !== session) {
        return;
      }
      latest = {
        data: frame.data,
        width: Math.round(frame.metadata?.deviceWidth ?? viewport.width),
        height: Math.round(frame.metadata?.deviceHeight ?? viewport.height),
      };
      for (const listener of listeners.keys()) {
        listener(latest);
      }
    });
    await session.send('Page.startScreencast', {
      format: 'jpeg',
      quality,
      maxWidth: viewport.width,
      maxHeight: viewport.height,
    });
  }

  /* Starts and stops run one after another, so a tab switch during a start cannot leave two casts. */
  const queue = (task) => {
    switching = switching.then(task, task).catch(() => {});
    return switching;
  };

  return {
    /** Sends every frame to `listener`, the latest one first; returns the unsubscribe. */
    subscribe(listener, { quality = 50 } = {}) {
      listeners.set(listener, Math.min(Math.max(Math.round(quality), 20), 90));
      if (latest) {
        listener(latest);
      }
      void queue(startCast);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          void queue(stopCast);
        }
      };
    },
    /** Moves the cast to the active tab after one opened or closed. */
    follow() {
      if (listeners.size > 0) {
        void queue(startCast);
      }
    },
    stop: () => {
      listeners.clear();
      return queue(stopCast);
    },
  };
}

const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });

/**
 * Launches one Chromium with its own temporary profile and its own egress proxy. The browser
 * process gets a minimal environment, so the service token is not handed to it.
 */
export function createBrowserLauncher({
  executablePath = process.env.BROWSER_EXECUTABLE || undefined,
  proxyOptions = {},
  viewport = VIEWPORT,
} = {}) {
  return async function openBrowser({ onDomain = () => {}, onClose = () => {} } = {}) {
    const blocked = [];
    const proxy = createEgressProxy({
      ...proxyOptions,
      onBlocked: (event) => {
        blocked.push(event);
        if (blocked.length > 50) {
          blocked.shift();
        }
      },
    });
    const port = await listen(proxy);
    let browser;
    try {
      browser = await chromium.launch({
        executablePath,
        headless: true,
        timeout: LAUNCH_TIMEOUT_MS,
        /* `<-loopback>` sends localhost through the proxy too, which then refuses it. */
        proxy: { server: `http://127.0.0.1:${port}`, bypass: '<-loopback>' },
        args: ARGS,
        env: {
          PATH: process.env.PATH ?? '/usr/bin:/bin',
          HOME: '/tmp',
          TZ: 'Asia/Tehran',
          LANG: 'fa_IR.UTF-8',
        },
      });
      const context = await browser.newContext({
        acceptDownloads: false,
        locale: 'fa-IR',
        timezoneId: 'Asia/Tehran',
        viewport,
      });
      const pages = [];
      function watch(page) {
        pages.push(page);
        page.on('framenavigated', (frame) => {
          if (frame === page.mainFrame()) {
            try {
              const { protocol, hostname } = new URL(frame.url());
              if ((protocol === 'http:' || protocol === 'https:') && hostname) {
                onDomain(hostname);
              }
            } catch {
              /* about:blank and other non-URLs */
            }
          }
        });
        page.on('close', () => {
          const index = pages.indexOf(page);
          if (index !== -1) {
            pages.splice(index, 1);
          }
        });
      }
      const screencast = createScreencast({
        context,
        viewport,
        page: () => pages[pages.length - 1],
      });
      context.on('page', (page) => {
        watch(page);
        /* A link that opens a tab moves the work there, so the live view follows. */
        screencast.follow();
        page.on('close', () => screencast.follow());
      });
      await context.newPage();
      browser.on('disconnected', onClose);
      return {
        /** The newest open tab: a link that opens a new tab moves the work there. */
        page: () => pages[pages.length - 1],
        blocked: () => blocked.slice(),
        frames: screencast.subscribe,
        async close() {
          browser.off('disconnected', onClose);
          await screencast.stop();
          await browser.close().catch(() => {});
          proxy.close();
        },
      };
    } catch (error) {
      await browser?.close().catch(() => {});
      proxy.close();
      throw error;
    }
  };
}
