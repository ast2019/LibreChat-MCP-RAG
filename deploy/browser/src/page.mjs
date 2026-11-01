import { WEB_PORTS, readWebUrl } from './address.mjs';
import { resolvePublic } from './egress.mjs';
import { BrowserError } from './sessions.mjs';

const NAVIGATION_TIMEOUT_MS = 30_000;
const SETTLE_MS = 3_000;
const INPUT_SETTLE_MS = 1_500;
const ACTION_TIMEOUT_MS = 10_000;
const SNAPSHOT_CHARS = 12_000;
const MAX_SNAPSHOT_CHARS = 60_000;
const SCROLL_PX = 640;
const MAX_SCROLL_PX = 2_000;
const MAX_WAIT_MS = 5_000;
const MAX_TYPED_CHARS = 500;
const REDACTED = '••••••';

/* Fields whose values the model never reads: passwords, card details and one-time codes. */
const SECRET_AUTOCOMPLETE = [
  'current-password',
  'new-password',
  'one-time-code',
  'cc-number',
  'cc-csc',
  'cc-exp',
  'cc-exp-month',
  'cc-exp-year',
];
const SECRET_NAME = '(^|[^a-z])(pass(word|wd)?|pwd|pin2?|cvv2?|cvc|otp|secret)([^a-z]|$)|رمز';

/** Keys the user's own buttons in the live view send. */
const INPUT_KEYS = new Set([
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
]);

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

/** The values of the page's secret fields (in every frame), which the snapshot must not show. */
async function secretValues(page) {
  const values = new Set();
  for (const frame of page.frames()) {
    const found = await frame
      .evaluate(
        ({ autocomplete, pattern }) => {
          const name = new RegExp(pattern, 'i');
          return [...document.querySelectorAll('input, textarea')]
            .filter((field) => {
              if (!field.value) {
                return false;
              }
              const hints = [field.name, field.id, field.getAttribute('aria-label'), field.placeholder]
                .filter(Boolean)
                .join(' ');
              return (
                field.type === 'password' ||
                autocomplete.includes(String(field.autocomplete ?? '').toLowerCase()) ||
                name.test(hints)
              );
            })
            .map((field) => field.value);
        },
        { autocomplete: SECRET_AUTOCOMPLETE, pattern: SECRET_NAME },
      )
      .catch(() => []);
    for (const value of found) {
      values.add(value);
    }
  }
  return values;
}

/**
 * The snapshot with the value of every secret field replaced. Playwright prints a field's value
 * after its line (`- textbox "رمز" [ref=e6]: …`), password fields included, so those lines are
 * rewritten before the model sees the page.
 */
export function redactSnapshot(snapshot, values) {
  if (values.size === 0) {
    return snapshot;
  }
  return snapshot
    .split('\n')
    .map((line) => {
      const match = /^(\s*- (?:textbox|searchbox|spinbutton|combobox)\b.*?): (.+)$/.exec(line);
      if (!match) {
        return line;
      }
      let value = match[2];
      if (value.startsWith('"')) {
        try {
          value = JSON.parse(value);
        } catch {
          /* not JSON-quoted; compare as printed */
        }
      }
      return values.has(value) || values.has(match[2]) ? `${match[1]}: ${REDACTED}` : line;
    })
    .join('\n');
}

/**
 * The page as an accessibility tree with element refs (`[ref=e12]`), without the values of
 * secret fields, `chars` at a time from `offset`; optionally a screenshot.
 */
export async function readPage(handle, { offset = 0, chars = SNAPSHOT_CHARS, screenshot = false } = {}) {
  const page = activePage(handle);
  const [raw, secrets] = await Promise.all([
    page.ariaSnapshot({ mode: 'ai', timeout: ACTION_TIMEOUT_MS }),
    secretValues(page),
  ]);
  const snapshot = redactSnapshot(raw, secrets);
  const size = Math.min(Math.max(Math.round(Number(chars) || SNAPSHOT_CHARS), 1_000), MAX_SNAPSHOT_CHARS);
  const start = Math.min(Math.max(Math.round(Number(offset) || 0), 0), snapshot.length);
  const result = {
    ...(await where(page)),
    snapshot: snapshot.slice(start, start + size),
    offset: start,
    total: snapshot.length,
    truncated: start + size < snapshot.length,
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

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/** What kind of field has the focus, so the live view can hide what the user types into it. */
async function focusKind(page) {
  return page
    .evaluate(() => {
      let field = document.activeElement;
      while (field && field.tagName === 'IFRAME') {
        const inner = field.contentDocument;
        /* A cross-origin frame (a card form, say) cannot be looked into: treat it as secret. */
        if (!inner) {
          return 'password';
        }
        field = inner.activeElement;
      }
      if (!field || field === document.body) {
        return null;
      }
      if (field.tagName === 'INPUT') {
        return field.type === 'password' ? 'password' : 'text';
      }
      return field.tagName === 'TEXTAREA' || field.isContentEditable ? 'text' : null;
    })
    .catch(() => null);
}

/**
 * The user's own step in the live view: a click at a point of the viewport, text typed into the
 * focused field, a key, a scroll or back. What the user types goes to the page only: it is not
 * logged, stored or shown to the model.
 */
export async function userInput(handle, input = {}) {
  const page = activePage(handle);
  const type = String(input.type ?? '');
  try {
    if (type === 'click') {
      const x = Number(input.x);
      const y = Number(input.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new BrowserError('invalid_input', 'A click needs x and y');
      }
      const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
      await page.mouse.click(clamp(x, 0, viewport.width - 1), clamp(y, 0, viewport.height - 1));
    } else if (type === 'type') {
      const text = String(input.text ?? '').slice(0, MAX_TYPED_CHARS);
      if (text === '') {
        throw new BrowserError('invalid_input', 'Nothing to type');
      }
      await page.keyboard.insertText(text);
    } else if (type === 'key') {
      const key = String(input.key ?? '');
      if (!INPUT_KEYS.has(key)) {
        throw new BrowserError('invalid_input', `Key ${key} is not allowed`);
      }
      await page.keyboard.press(key);
    } else if (type === 'scroll') {
      await page.mouse.wheel(0, clamp(Number(input.dy) || 0, -MAX_SCROLL_PX, MAX_SCROLL_PX));
    } else if (type === 'back') {
      await page.goBack({ timeout: NAVIGATION_TIMEOUT_MS, waitUntil: 'domcontentloaded' });
    } else {
      throw new BrowserError('invalid_input', `Unknown input ${type}`);
    }
  } catch (error) {
    if (error instanceof BrowserError) {
      throw error;
    }
    throw new BrowserError('input_failed', String(error?.message ?? error).split('\n')[0], 422);
  }
  const current = activePage(handle);
  await current.waitForLoadState('load', { timeout: INPUT_SETTLE_MS }).catch(() => undefined);
  return { ...(await where(current)), focus: await focusKind(current) };
}
