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
      const watch = (page) => {
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
      };
      context.on('page', watch);
      await context.newPage();
      browser.on('disconnected', onClose);
      return {
        /** The newest open tab: a link that opens a new tab moves the work there. */
        page: () => pages[pages.length - 1],
        blocked: () => blocked.slice(),
        async close() {
          browser.off('disconnected', onClose);
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
