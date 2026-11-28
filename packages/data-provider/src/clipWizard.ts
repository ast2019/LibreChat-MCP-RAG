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
  'cap_exceeded',
  'model_unavailable',
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
  /** The model that drafts and edits storyboards (never the Claude time pack) */
  llm: z
    .object({
      /** Custom endpoint whose server key, base URL and price multiplier the calls use */
      endpoint: z.string().min(1).default('OpenRouter'),
      /** Most tokens the model may answer with in one call */
      maxOutputTokens: z.number().int().min(256).max(32_000).default(6_000),
      /** One call's time limit, in milliseconds */
      timeoutMs: z.number().int().min(5_000).max(300_000).default(90_000),
      /** Extra calls that feed the validator's issues back to the model */
      repairAttempts: z.number().int().min(0).max(3).default(1),
      /** Most earlier chat messages sent along with a chat edit */
      chatHistoryTurns: z.number().int().min(1).max(40).default(10),
      /** Longest chat message or topic, in characters */
      maxChatChars: z.number().int().min(200).max(20_000).default(2_000),
    })
    .default({}),
  /** AI images in the wizard: off until the owner turns them on */
  images: z
    .object({
      /** Lets the wizard render AI images (OpenRouter or Higgsfield) even when `aiImages` is off */
      enabled: z.boolean().default(false),
      /** Spending cap for one clip's AI images, in credits; 0 uses `maxAiImages` only */
      maxCreditsPerClip: z.number().int().min(0).max(100_000_000).default(0),
    })
    .default({}),
  /**
   * Deprecated and ignored: voice samples are always pre-generated at the platform's cost and
   * never charged to a user. Kept so existing configs still parse.
   */
  sampleCharge: z.enum(['platform', 'requester']).default('platform'),
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
  /** Whether the voice has a sample to play (every voice, free Edge voices included) */
  hasSample: z.boolean(),
});

export type TClipWizardVoice = z.infer<typeof clipWizardVoiceSchema>;

export const clipWizardImageSources = ['builtin', 'openrouter', 'higgsfield'] as const;

export const clipWizardModelSchema = z.object({
  id: z.string(),
  label: z.string(),
  group: z.string().optional(),
});

export type TClipWizardModel = z.infer<typeof clipWizardModelSchema>;

export const clipWizardImageModelSchema = z.object({
  id: z.string(),
  label: z.string(),
  source: z.enum(['openrouter', 'higgsfield']),
  /** Credits one image of this model is estimated at */
  credits: z.number(),
});

export type TClipWizardImageModel = z.infer<typeof clipWizardImageModelSchema>;

export const clipWizardAspectRatios = ['9:16', '4:5', '1:1', '16:9'] as const;

export const clipWizardConfigResponseSchema = z.object({
  enabled: z.boolean(),
  voices: z.array(clipWizardVoiceSchema),
  /** Models the user may pick to write and edit the storyboard (spec names, not provider ids) */
  models: z.array(clipWizardModelSchema),
  defaultModelId: z.string().nullable(),
  imageModels: z.array(clipWizardImageModelSchema),
  /** Spending cap for one clip's AI images in credits; 0 means only the image count limits it */
  imageCapCredits: z.number(),
  limits: z.object({
    maxDurationSec: z.number(),
    maxScenes: z.number(),
    maxAssetMb: z.number(),
    maxAiImages: z.number(),
    maxChatChars: z.number(),
  }),
  aspectRatios: z.array(z.enum(clipWizardAspectRatios)),
  themes: z.array(z.object({ id: z.string(), label: z.string() })),
  imageSources: z.object({
    builtin: z.boolean(),
    stock: z.boolean(),
    ai: z.boolean(),
    /** True only when the Higgsfield keys resolve on the server */
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

export const clipWizardImagesSchema = z.object({
  source: z.enum(clipWizardImageSources),
  modelId: z.string().min(1).max(120).optional(),
  /** The user's own spending cap for this clip's AI images, in credits */
  maxCredits: z.number().int().min(0).max(100_000_000).optional(),
});

export type TClipWizardImages = z.infer<typeof clipWizardImagesSchema>;

export const clipWizardValidateRequestSchema = z.object({
  storyboard: clipWizardStoryboardSchema,
  images: clipWizardImagesSchema.optional(),
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
      /** Where AI images come from; absent means the deployment's own `aiImages` rule */
      images: clipWizardImagesSchema.optional(),
    })
    .default({}),
});

export type TClipWizardRenderRequest = z.infer<typeof clipWizardRenderRequestSchema>;

/** The job the existing media job endpoints and the MediaJob card poll. */
export type TClipWizardRenderResponse = { jobId: string };

const clipWizardDraftSettingsSchema = z.object({
  aspectRatio: z.enum(clipWizardAspectRatios).optional(),
  targetDurationSec: z.number().min(5).max(180).optional(),
  language: z.enum(['fa', 'en']).optional(),
});

export const clipWizardDraftRequestSchema = z.object({
  topic: z.string().trim().min(3).max(20_000),
  settings: clipWizardDraftSettingsSchema.default({}),
  modelId: z.string().min(1).max(100),
  images: clipWizardImagesSchema.optional(),
});

export type TClipWizardDraftRequest = z.infer<typeof clipWizardDraftRequestSchema>;

export type TClipWizardDraftResponse = {
  storyboard: TClipWizardStoryboard;
  /** Credits actually charged for the call */
  credits: number;
};

export const clipWizardChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(20_000),
});

export type TClipWizardChatMessage = z.infer<typeof clipWizardChatMessageSchema>;

export const clipWizardChatRequestSchema = z.object({
  modelId: z.string().min(1).max(100),
  messages: z.array(clipWizardChatMessageSchema).min(1).max(200),
  storyboard: clipWizardStoryboardSchema,
  topic: z.string().max(20_000).optional(),
  settings: clipWizardDraftSettingsSchema.default({}),
  images: clipWizardImagesSchema.optional(),
});

export type TClipWizardChatRequest = z.infer<typeof clipWizardChatRequestSchema>;

export type TClipWizardChatResponse = {
  reply: string;
  /** The edited storyboard, or null when the model only answered */
  storyboard: TClipWizardStoryboard | null;
  credits: number;
};

export const clipWizardEstimateRequestSchema = z.object({
  storyboard: clipWizardStoryboardSchema,
  settings: z
    .object({
      aspectRatio: z.enum(clipWizardAspectRatios).optional(),
      voiceId: z.string().min(1).max(60).optional(),
      images: clipWizardImagesSchema.optional(),
    })
    .default({}),
});

export type TClipWizardEstimateRequest = z.infer<typeof clipWizardEstimateRequestSchema>;

export type TClipWizardEstimateResponse =
  | {
      ok: true;
      items: { narrationCredits: number; imageCredits: number };
      imageCount: number;
      totalCredits: number;
      /** The cap that applies to the images, in credits, when there is one */
      capCredits?: number;
    }
  | { ok: false; issues: TClipWizardIssue[] };

export type TClipWizardError = { error: { code: TClipWizardErrorCode } };
