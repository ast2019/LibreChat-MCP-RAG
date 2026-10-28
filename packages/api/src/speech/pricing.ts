/** Balance unit used by chat billing: 1,000,000 credits = 1 USD at selling price. */
export const SPEECH_CREDITS_PER_USD = 1_000_000;

/** Bytes per second assumed for compressed browser recordings (16 kbps) when estimating length. */
export const MIN_RECORDING_BYTES_PER_SECOND = 2000;

/** Credits of a provider charge: USD × the endpoint's `priceMultiplier`, exactly like chat. */
export function usdToCredits(usd: number, priceMultiplier: number): number {
  const credits = usd * priceMultiplier * SPEECH_CREDITS_PER_USD;
  return Math.round(credits * 1e6) / 1e6;
}

/** USD of `seconds` of audio at `usdPerMinute`. */
export function secondsToUsd(seconds: number, usdPerMinute: number): number {
  return (Math.max(0, seconds) / 60) * usdPerMinute;
}

/**
 * Upper-bound length of an upload for a balance hold: the bytes at a low bitrate, capped at the
 * longest recording the client allows.
 */
export function estimateRecordingSeconds(bytes: number, maxDurationSeconds: number): number {
  return Math.min(maxDurationSeconds, Math.ceil(bytes / MIN_RECORDING_BYTES_PER_SECOND));
}

/** Expected speech length of a text. */
export function estimateSpeechSeconds(characters: number, charsPerSecond: number): number {
  return characters / charsPerSecond;
}
