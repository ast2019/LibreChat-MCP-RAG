import { WEB_PORTS, readWebUrl } from './address.mjs';
import { resolvePublic } from './egress.mjs';
import { BrowserError } from './sessions.mjs';

const NAVIGATION_TIMEOUT_MS = 30_000;
const SETTLE_MS = 3_000;
const ACTION_TIMEOUT_MS = 10_000;
const SNAPSHOT_CHARS = 40_000;
const SCROLL_PX = 640;
const MAX_WAIT_MS = 5_000;

const ACTIONS = new Set(['click', 'type', 'select', 'press', 'scroll', 'back', 'wait']);
const KEYS = new Set([
  'Enter',
  'Tab',
  'Escape',
  'Backspace',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PageUp',
  'PageDown',
  'Home',
  'End',
]);

const settle = (page) =>
  page.waitForLoadState('load', { timeout: SETTLE_MS }).catch(() => undefined);

const where = async (page) => ({ url: page.url(), title: await page.title().catch(() => '') });

const activePage = (handle) => {
  const page = handle.page();
  if (!page) {
    throw new BrowserError('not_found', 'The browser has no open tab', 404);
  }
  return page;
};

/** Opens an http(s) address after checking that its name resolves only to public addresses. */
export async function openUrl(handle, rawUrl, { ports = WEB_PORTS, ...policy } = {}) {
  let url;
  try {
    url = readWebUrl(rawUrl);
  } catch (error) {
    throw new BrowserError('invalid_url', error.message);
  }
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  if (!ports.includes(port)) {
    throw new BrowserError('blocked_address', 'Only ports 80 and 443 open', 403);
  }
  try {
    await resolvePublic(url.hostname, policy);
  } catch (error) {
    if (error.code === 'blocked_address') {
      throw new BrowserError('blocked_address', 'That address is not on the public internet', 403);
    }
    throw new BrowserError('navigation_failed', `${url.hostname} could not be found`, 502);
  }
  const page = activePage(handle);
  try {
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
  } catch (error) {
    const message = String(error?.message ?? error).split('\n')[0];
    throw new BrowserError('navigation_failed', message, 502);
  }
  await settle(page);
  return where(page);
}

/** The page as an accessibility tree with element refs (`[ref=e12]`), and a screenshot. */
export async function readPage(handle, { screenshot = false } = {}) {
  const page = activePage(handle);
  const snapshot = await page.ariaSnapshot({ mode: 'ai', timeout: ACTION_TIMEOUT_MS });
  const result = {
    ...(await where(page)),
    snapshot: snapshot.length > SNAPSHOT_CHARS ? snapshot.slice(0, SNAPSHOT_CHARS) : snapshot,
    truncated: snapshot.length > SNAPSHOT_CHARS,
  };
  if (screenshot) {
    const image = await page.screenshot({ type: 'jpeg', quality: 70, timeout: ACTION_TIMEOUT_MS });
    result.screenshot = image.toString('base64');
  }
  return result;
}

const readRef = (value) => {
  if (typeof value !== 'string' || !/^e\d{1,6}$/.test(value)) {
    throw new BrowserError('invalid_action', 'A ref like e12 from the last page read is needed');
  }
  return value;
};

/** One step on the page: click, type, select, press a key, scroll, go back, or wait. */
export async function act(handle, step = {}) {
  const action = String(step.action ?? '');
  if (!ACTIONS.has(action)) {
    throw new BrowserError('invalid_action', `Unknown action ${action}`);
  }
  const page = activePage(handle);
  const target = () => page.locator(`aria-ref=${readRef(step.ref)}`);
  try {
    if (action === 'click') {
      await target().click({ timeout: ACTION_TIMEOUT_MS });
    } else if (action === 'type') {
      await target().fill(String(step.text ?? '').slice(0, 2_000), { timeout: ACTION_TIMEOUT_MS });
      if (step.submit === true) {
        await target().press('Enter', { timeout: ACTION_TIMEOUT_MS });
      }
    } else if (action === 'select') {
      await target().selectOption(String(step.value ?? ''), { timeout: ACTION_TIMEOUT_MS });
    } else if (action === 'press') {
      const key = String(step.key ?? '');
      if (!KEYS.has(key)) {
        throw new BrowserError('invalid_action', `Key ${key} is not allowed`);
      }
      await page.keyboard.press(key);
    } else if (action === 'scroll') {
      await page.mouse.wheel(0, step.direction === 'up' ? -SCROLL_PX : SCROLL_PX);
    } else if (action === 'back') {
      await page.goBack({ timeout: NAVIGATION_TIMEOUT_MS, waitUntil: 'domcontentloaded' });
    } else {
      await page.waitForTimeout(Math.min(Math.max(Number(step.ms) || 1_000, 0), MAX_WAIT_MS));
    }
  } catch (error) {
    if (error instanceof BrowserError) {
      throw error;
    }
    const message = String(error?.message ?? error).split('\n')[0];
    throw new BrowserError('action_failed', message, 422);
  }
  await settle(activePage(handle));
  return where(activePage(handle));
}
