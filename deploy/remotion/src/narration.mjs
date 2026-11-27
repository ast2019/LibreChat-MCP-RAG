// Narration made outside the worker (one audio file per scene): caption timings without word marks.

/**
 * Splits a narration line into words and spreads them over `durationSec` in proportion to their
 * character count (the provider returns no word timestamps). Returns { text, startMs, endMs }.
 */
export function proportionalWords(text, durationSec) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const total = words.reduce((sum, word) => sum + [...word].length, 0);
  if (words.length === 0 || total === 0 || !(durationSec > 0)) {
    return [];
  }
  const totalMs = durationSec * 1000;
  let used = 0;
  return words.map((word) => {
    const startMs = Math.round((used / total) * totalMs);
    used += [...word].length;
    return { text: word, startMs, endMs: Math.round((used / total) * totalMs) };
  });
}

/**
 * The scene lines of a `scenes` audio spec as [{ index, asset }], sorted; null when invalid.
 * Each asset must be an audio asset and each index a scene that exists.
 */
export function parseSceneLines(lines, sceneCount, kinds) {
  if (!lines || typeof lines !== 'object' || Array.isArray(lines)) {
    return null;
  }
  const out = [];
  for (const [key, asset] of Object.entries(lines)) {
    const index = Number(key);
    if (!/^\d{1,3}$/.test(key) || index >= sceneCount || typeof asset !== 'string' || kinds[asset]?.kind !== 'audio') {
      return null;
    }
    out.push({ index, asset });
  }
  return out.length > 0 ? out.sort((a, b) => a.index - b.index) : null;
}
