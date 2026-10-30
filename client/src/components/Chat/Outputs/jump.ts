import { completeProgressiveRowMounts } from '~/hooks/Messages/useProgressiveRowMount';

/**
 * The rendered row of a message, once a long thread has mounted every row. `null` when the
 * message is not on screen, e.g. it sits on a branch the user is not viewing. `aria-hidden` is not
 * checked: an open modal dialog marks the whole page that way.
 */
export async function findMessageRow(messageId: string): Promise<HTMLElement | null> {
  await completeProgressiveRowMounts();
  const row = document.getElementById(messageId);
  if (row == null || row.closest('[inert], [hidden]') != null) {
    return null;
  }
  return row;
}

/** Moves focus to a message row and brings it into view, honoring reduced motion. */
export function focusMessageRow(row: HTMLElement): void {
  if (!row.hasAttribute('tabindex')) {
    row.tabIndex = -1;
    row.addEventListener('blur', () => row.removeAttribute('tabindex'), { once: true });
  }
  row.focus({ preventScroll: true });
  row.scrollIntoView?.({
    block: 'start',
    behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ? 'instant'
      : 'smooth',
  });
}
