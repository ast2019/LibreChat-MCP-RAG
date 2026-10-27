import { DEFAULT_TITLE_FALLBACK } from './sanitizeTitle';

/** Most words a fallback title keeps from the user's first message. */
export const FALLBACK_TITLE_MAX_WORDS = 8;
/** Most characters (code points, ellipsis included) of a fallback title. */
export const FALLBACK_TITLE_MAX_LENGTH = 50;
const ELLIPSIS = '…';

/** Drops markdown syntax but keeps the words a reader would see. */
function stripMarkdown(text: string): string {
  return (
    text
      // `<think>` blocks and HTML tags
      .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, ' ')
      .replace(/<\/?[a-z][^>]*>/gi, ' ')
      // code fence lines (```lang / ~~~), keeping the fenced content
      .replace(/^\s*(```|~~~)[^\n]*$/gm, ' ')
      // images and links: keep the alt/label text
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      // headings, blockquotes, list markers, horizontal rules at line start
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s*>+\s?/gm, '')
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
      .replace(/^\s*(?:[-*_]\s*){3,}$/gm, ' ')
      // inline emphasis/code/strike markers and table pipes
      .replace(/[`*~|]+/g, ' ')
      // `_emphasis_` markers, but not underscores inside identifiers like `snake_case`
      .replace(/(^|\s)_+|_+(?=\s|$)/g, '$1')
  );
}

/**
 * A deterministic conversation title built from the user's first message, for when no title
 * model runs (the endpoint disables `titleConvo`) or the model fails, times out or answers
 * with nothing. Strips markdown and whitespace, keeps the first
 * {@link FALLBACK_TITLE_MAX_WORDS} words within {@link FALLBACK_TITLE_MAX_LENGTH} characters,
 * and ends with `…` when anything was cut.
 *
 * @returns The title, or `null` when the message has no usable text.
 */
export function buildFallbackTitle(text: unknown): string | null {
  if (typeof text !== 'string' || text.length === 0) {
    return null;
  }
  const words = stripMarkdown(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return null;
  }

  let truncated = words.length > FALLBACK_TITLE_MAX_WORDS;
  const kept = words.slice(0, FALLBACK_TITLE_MAX_WORDS);
  let title = kept.join(' ');

  const limit = FALLBACK_TITLE_MAX_LENGTH - ELLIPSIS.length;
  if ([...title].length > FALLBACK_TITLE_MAX_LENGTH || (truncated && [...title].length > limit)) {
    truncated = true;
    /** Prefer cutting at a word boundary; a single overlong word is cut mid-word. */
    while (kept.length > 1 && [...kept.join(' ')].length > limit) {
      kept.pop();
    }
    title = kept.join(' ');
    if ([...title].length > limit) {
      title = [...title].slice(0, limit).join('');
    }
  }

  if (truncated) {
    title = title.replace(/[\s.,;:!?،؛…-]+$/u, '');
    return title.length > 0 ? `${title}${ELLIPSIS}` : null;
  }
  return title;
}

/** Whether a title model's answer means "no title": nothing, blank, or the sanitizer's placeholder. */
export function isMissingGeneratedTitle(title: unknown): boolean {
  return typeof title !== 'string' || title.trim() === '' || title === DEFAULT_TITLE_FALLBACK;
}
