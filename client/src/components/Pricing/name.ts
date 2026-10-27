/** Family words written as acronyms; a version that follows one joins it with a hyphen (`GPT-6.1`). */
const ACRONYMS = new Set(['gpt', 'glm', 'qwq', 'oss', 'vl', 'llm']);

/** Brand words with their own capitalization. */
const BRANDS: Record<string, string> = {
  chatgpt: 'ChatGPT',
  deepseek: 'DeepSeek',
  openai: 'OpenAI',
  minimax: 'MiniMax',
};

const isVersion = (token: string): boolean => /^\d/.test(token);
const isShortNumber = (token: string): boolean => /^\d{1,2}$/.test(token);
/** Parameter counts: `70b`, `1.5b` */
const isSize = (token: string): boolean => /^\d+(\.\d+)?[bkm]$/i.test(token);

function formatToken(token: string): string {
  const lower = token.toLowerCase();
  if (BRANDS[lower] != null) {
    return BRANDS[lower];
  }
  if (ACRONYMS.has(lower)) {
    return lower.toUpperCase();
  }
  if (isSize(token)) {
    return token.toUpperCase();
  }
  /** Versions (`5.5`, `4o`) and OpenAI's `o3`-style names stay as written */
  if (isVersion(token) || /^o\d/.test(lower)) {
    return lower;
  }
  if (/^v\d/.test(lower)) {
    return `V${lower.slice(1)}`;
  }
  return token.charAt(0).toUpperCase() + token.slice(1);
}

/**
 * A provider model id as a name people read: the provider prefix, OpenRouter's `~` alias
 * marker and any `:variant` suffix are dropped, family words are title-cased and the version
 * is kept — `openai/gpt-6.1-sol` → `GPT-6.1 Sol`, `anthropic/claude-sonnet-4-5` →
 * `Claude Sonnet 4.5`. Returns the id unchanged when nothing readable remains.
 */
export function formatModelName(id: string): string {
  const raw = id.trim();
  const base = raw.replace(/^~/, '').split('/').pop()?.split(':')[0] ?? '';
  const tokens = base.split(/[-_\s]+/).filter(Boolean);
  if (tokens.length === 0) {
    return raw;
  }

  const words: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    let token = tokens[i];
    /** Anthropic writes `4.5` as `4-5`; two short numbers in a row are one version */
    if (isShortNumber(token) && i + 1 < tokens.length && isShortNumber(tokens[i + 1])) {
      token = `${token}.${tokens[i + 1]}`;
      i++;
    }
    const word = formatToken(token);
    const next = tokens[i + 1];
    /** `GPT-6.1`, `GPT-OSS`; a parameter count after it (`120b`) stays a word of its own */
    const joinsNext =
      next != null && (ACRONYMS.has(next.toLowerCase()) || (isVersion(next) && !isSize(next)));
    if (ACRONYMS.has(token.toLowerCase()) && joinsNext) {
      words.push(`${word}-${formatToken(next)}`);
      i++;
      continue;
    }
    words.push(word);
  }
  return words.join(' ');
}
