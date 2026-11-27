import { z } from 'zod';

/** Stable codes the clip wizard endpoints answer with (`{ error: { code } }`); the UI maps each to copy. */
export const CLIP_WIZARD_ERROR_CODES = [
  'wizard_disabled',
  'not_allowed',
  'insufficient_credit',
  'provider_failed',
  'no_sample',
  'invalid_request',
  'invalid_storyboard',
  'busy',
  'unavailable',
  'server_error',
] as const;

export type TClipWizardErrorCode = (typeof CLIP_WIZARD_ERROR_CODES)[number];

/** Who may open the wizard: everyone, or the users media generation is open to (a pack, an admin). */
export const clipWizardAccessSchema = z.enum(['everyone', 'pack']);

/** `clipTools.wizard`: the dedicated clip builder page. */
export const clipWizardConfigSchema = z.object({
  /** Turns the wizard page and its endpoints on */
  enabled: z.boolean().default(false),
  /** `pack` follows `mediaGeneration` (`paidOnly`, pack `grants.media`) through the same access check */
  access: clipWizardAccessSchema.default('pack'),
});

export type TClipWizardSettings = z.infer<typeof clipWizardConfigSchema>;

export const clipWizardVoiceSchema = z.object({
  id: z.string(),
  label: z.string(),
  lang: z.enum(['fa', 'en']),
  provider: z.enum(['edge', 'openrouter']),
  model: z.string().optional(),
  /** `free` runs on the render worker; `paid` is charged from credit */
  priceHint: z.enum(['free', 'paid']),
  /** Only paid voices: USD per 1000 characters when the catalogue sets one */
  estimateUsdPerKChar: z.number().optional(),
  /** Whether the voice has a sample to play (paid voices only) */
  hasSample: z.boolean(),
});

export type TClipWizardVoice = z.infer<typeof clipWizardVoiceSchema>;

export const clipWizardAspectRatios = ['9:16', '4:5', '1:1', '16:9'] as const;

export const clipWizardConfigResponseSchema = z.object({
  enabled: z.boolean(),
  voices: z.array(clipWizardVoiceSchema),
  limits: z.object({
    maxDurationSec: z.number(),
    maxScenes: z.number(),
    maxAssetMb: z.number(),
  }),
  aspectRatios: z.array(z.enum(clipWizardAspectRatios)),
  themes: z.array(z.object({ id: z.string(), label: z.string() })),
  imageSources: z.object({
    builtin: z.boolean(),
    stock: z.boolean(),
    ai: z.boolean(),
    /** Not connected in phase 2a; the owner sets the keys later */
    higgsfield: z.boolean(),
  }),
});

export type TClipWizardConfigResponse = z.infer<typeof clipWizardConfigResponseSchema>;

/** One problem in a storyboard: the field path and what is wrong. */
export const clipWizardIssueSchema = z.object({
  field: z.string(),
  message: z.string(),
});

export type TClipWizardIssue = z.infer<typeof clipWizardIssueSchema>;

/** The storyboard as the `create_remotion_clip` tool takes it (title, theme, scenes with narration). */
export const clipWizardStoryboardSchema = z.record(z.unknown());

export type TClipWizardStoryboard = z.infer<typeof clipWizardStoryboardSchema>;

export const clipWizardValidateRequestSchema = z.object({
  storyboard: clipWizardStoryboardSchema,
});

export type TClipWizardValidateRequest = z.infer<typeof clipWizardValidateRequestSchema>;

export type TClipWizardValidateResponse =
  | { ok: true; durationSec: number; scenes: number; notes: string[] }
  | { ok: false; issues: TClipWizardIssue[] };

export const clipWizardVoiceSampleRequestSchema = z.object({
  voiceId: z.string().min(1).max(60),
});

export type TClipWizardVoiceSampleRequest = z.infer<typeof clipWizardVoiceSampleRequestSchema>;

export type TClipWizardVoiceSampleResponse = {
  voiceId: string;
  mime: string;
  base64: string;
  /** Served from the cache; nothing was charged */
  cached: boolean;
};

export const clipWizardRenderRequestSchema = z.object({
  storyboard: clipWizardStoryboardSchema,
  settings: z
    .object({
      aspectRatio: z.enum(clipWizardAspectRatios).optional(),
      /** A catalogue voice id; empty or absent renders without narration */
      voiceId: z.string().min(1).max(60).optional(),
    })
    .default({}),
});

export type TClipWizardRenderRequest = z.infer<typeof clipWizardRenderRequestSchema>;

/** The job the existing media job endpoints and the MediaJob card poll. */
export type TClipWizardRenderResponse = { jobId: string };

export type TClipWizardError = { error: { code: TClipWizardErrorCode } };
