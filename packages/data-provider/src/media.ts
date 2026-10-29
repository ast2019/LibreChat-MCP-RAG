import { z } from 'zod';

/** Names of the in-chat media generation tools; the chat model calls them mid-conversation. */
export enum MediaTools {
  image = 'generate_image',
  video = 'generate_video',
  speech = 'generate_speech',
  higgsfield = 'higgsfield_generate',
}

export const MEDIA_TOOL_NAMES: readonly string[] = Object.values(MediaTools);

/** Ledger contexts media generation is charged under. */
export const MEDIA_TRANSACTION_CONTEXTS = {
  image: 'image_generation',
  video: 'video_generation',
  speech: 'speech_generation',
  higgsfield: 'higgsfield_generation',
} as const;

const durationMs = (fallback: number) =>
  z.number().int().min(1_000).max(3_600_000).default(fallback);

/** Image generation through the OpenRouter Image API (`POST /images`). */
export const mediaImageSchema = z.object({
  model: z.string().min(1),
  /** `512`, `768`, `1K`, `1.5K`, `2K`, `4K`; the provider default when unset */
  resolution: z.string().optional(),
  /** Held before the call so a user cannot overspend; the real cost is charged after. */
  estimateUsd: z.number().min(0).max(100).default(0.1),
  timeoutMs: durationMs(180_000),
});

/** Video generation through the OpenRouter Video API (`POST /videos`, then polling). */
export const mediaVideoSchema = z.object({
  model: z.string().min(1),
  resolution: z.string().default('720p'),
  defaultDuration: z.number().int().min(1).max(60).default(5),
  maxDuration: z.number().int().min(1).max(60).default(8),
  generateAudio: z.boolean().default(true),
  /** Per second of video, held before the call; the real cost is charged after. */
  estimateUsdPerSecond: z.number().min(0).max(100).default(0.3),
  pollIntervalMs: durationMs(10_000),
  timeoutMs: durationMs(900_000),
});

/** Speech generation through the OpenRouter speech API (`POST /audio/speech`). */
export const mediaSpeechSchema = z.object({
  model: z.string().min(1),
  voice: z.string().min(1),
  /** Other voices the model may choose when the user asks for one */
  voices: z.array(z.string().min(1)).max(50).optional(),
  /** `pcm` for models that only return raw audio (Gemini TTS); it is saved as WAV */
  format: z.enum(['mp3', 'pcm']).default('mp3'),
  /** Sample rate of 16-bit mono PCM, used to write the WAV header */
  pcmSampleRate: z.number().int().min(8_000).max(96_000).default(24_000),
  /** Delivery guidance for models that take it, e.g. the language and tone */
  instructions: z.string().max(1_000).optional(),
  maxChars: z.number().int().min(1).max(20_000).default(4_000),
  estimateUsd: z.number().min(0).max(100).default(0.05),
  timeoutMs: durationMs(120_000),
});

export const higgsfieldModelSchema = z.object({
  /** Model path on api.higgsfield.ai, e.g. `higgsfield-ai/soul/v2/standard` */
  id: z.string().regex(/^[a-z0-9][a-z0-9._/-]*$/i),
  kind: z.enum(['image', 'video']),
  label: z.string().min(1),
  description: z.string().optional(),
  /** Charged per generation; Higgsfield does not report the cost of one request. */
  priceUsd: z.number().min(0).max(100),
});

/** Higgsfield's own API, paid from the deployment's Higgsfield balance and charged to users. */
export const mediaHiggsfieldSchema = z.object({
  apiKeyId: z.string().min(1),
  apiKeySecret: z.string().min(1),
  baseURL: z.string().url().default('https://api.higgsfield.ai'),
  models: z.array(higgsfieldModelSchema).min(1).max(50),
  pollIntervalMs: durationMs(5_000),
  timeoutMs: durationMs(900_000),
});

export const mediaGenerationSchema = z.object({
  enabled: z.boolean().default(false),
  /** Only users who have bought (or been granted) a pack may generate; others are told why. */
  paidOnly: z.boolean().default(true),
  /** Custom endpoint whose server key, base URL and price multiplier the OpenRouter calls use */
  endpoint: z.string().default('OpenRouter'),
  image: mediaImageSchema.optional(),
  video: mediaVideoSchema.optional(),
  speech: mediaSpeechSchema.optional(),
  higgsfield: mediaHiggsfieldSchema.optional(),
});

export type TMediaGenerationConfig = z.infer<typeof mediaGenerationSchema>;
export type THiggsfieldModel = z.infer<typeof higgsfieldModelSchema>;
