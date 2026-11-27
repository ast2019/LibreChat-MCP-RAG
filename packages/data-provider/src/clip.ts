import { z } from 'zod';

/** In-chat tool that builds a storyboard motion clip on the HiveGPT Remotion worker. */
export enum ClipTools {
  clip = 'create_remotion_clip',
}

export const CLIP_TOOL_NAMES: readonly string[] = Object.values(ClipTools);

/** Deployment skills that declare the clip tool. */
export const CLIP_TOOL_SKILLS: Readonly<Record<ClipTools, readonly string[]>> = {
  [ClipTools.clip]: ['clip-builder'],
};

/** The file context generated clip files are stored under. */
export const CLIP_FILE_CONTEXT = 'clip_generation';

/** Key of the files a clip tool saved, on its tool artifact. */
export const CLIP_ARTIFACT_KEY = 'clip_files';

/** Longest clip any deployment may allow, in seconds. */
export const CLIP_HARD_MAX_DURATION_SEC = 180;

/** One narration voice the clip builder offers (a row of the `clipTools.voices` catalogue). */
export const clipVoiceSchema = z
  .object({
    /** Id the model passes as `audio.voice` */
    id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{1,59}$/),
    /** Persian name the user picks by */
    label: z.string().min(1).max(60),
    lang: z.enum(['fa', 'en']),
    /** `edge` runs on the render worker; `openrouter` goes through `media.speech` and is billed */
    provider: z.enum(['edge', 'openrouter']),
    /** Edge voice name (fa-IR-DilaraNeural), or the provider's voice (Kore) */
    voice: z.string().min(1).max(60),
    /** Speech model, required for `openrouter` */
    model: z.string().min(1).max(100).optional(),
  })
  .refine((entry) => entry.provider !== 'openrouter' || Boolean(entry.model), {
    message: 'model is required for the openrouter provider',
    path: ['model'],
  });

export type TClipVoice = z.infer<typeof clipVoiceSchema>;

/** The narration voices offered when `clipTools.voices` is not set (Edge, as before). */
export const DEFAULT_CLIP_VOICES: TClipVoice[] = [
  { id: 'fa-IR-DilaraNeural', label: 'دیلارا', lang: 'fa', provider: 'edge', voice: 'fa-IR-DilaraNeural' },
  { id: 'fa-IR-FaridNeural', label: 'فرید', lang: 'fa', provider: 'edge', voice: 'fa-IR-FaridNeural' },
  { id: 'en-US-JennyNeural', label: 'جنی', lang: 'en', provider: 'edge', voice: 'en-US-JennyNeural' },
];

export const clipToolsSchema = z.object({
  /** Storyboard motion clips from the «کلیپ‌ساز» row */
  clip: z.boolean().default(true),
  /** Longest clip, in seconds (hard cap 180) */
  maxDurationSec: z.number().int().min(5).max(CLIP_HARD_MAX_DURATION_SEC).default(90),
  /** Short side of the output in pixels (9:16 at 720 is 720×1280). Keep 720 to limit load. */
  height: z.number().int().min(360).max(1080).default(720),
  /** Most scenes in one storyboard */
  maxScenes: z.number().int().min(1).max(30).default(20),
  /** Clip jobs one user may have rendering or waiting at once */
  maxJobsPerUser: z.number().int().min(1).max(5).default(1),
  /** Render budget per clip on the worker, in seconds (sent with each job) */
  renderTimeoutSec: z.number().int().min(60).max(1800).default(600),
  /** How long a job may wait in the worker queue before it is given up, in seconds */
  queueTimeoutSec: z.number().int().min(60).max(3600).default(900),
  /** Key-frame previews (renderStill) the model may ask for before the full render */
  preview: z.boolean().default(true),
  /** How long the worker may spend on one preview, in seconds (it stops the render after) */
  previewTimeoutSec: z.number().int().min(10).max(600).default(120),
  /** Most key frames in one preview (one per scene from the start) */
  previewStills: z.number().int().min(1).max(30).default(6),
  /**
   * Images and audio one clip may send to the worker, in MB of file bytes. The worker's body
   * limit (REMOTION_BODY_LIMIT_MB, 80) counts base64, a third larger; keep this under 3/4 of it.
   */
  maxAssetMb: z.number().int().min(1).max(150).default(55),
  /** Times a clip submit is retried after a worker 5xx or a network failure before it fails */
  submitRetries: z.number().int().min(0).max(10).default(3),
  /** Narration with word-synced captions */
  captions: z.boolean().default(true),
  /** Narration voices the user may pick from; the first entry of the clip's language is the default */
  voices: z.array(clipVoiceSchema).min(1).max(30).default(DEFAULT_CLIP_VOICES),
  /** Bundled CC0 background music with ducking under narration */
  music: z.boolean().default(true),
  /** AI images generated for a clip (opt-in per storyboard), charged like the image tool */
  aiImages: z.boolean().default(false),
  /** Most AI images in one clip */
  maxAiImages: z.number().int().min(1).max(8).default(3),
  /** Pexels stock photos, only when the server has PEXELS_API_KEY */
  stockImages: z.boolean().default(true),
  /** Most stock photos in one clip */
  maxStockImages: z.number().int().min(1).max(12).default(6),
  /** Remotion renders the worker runs at once (informational; the worker reads REMOTION_MAX_CONCURRENT) */
  maxConcurrent: z.number().int().min(1).max(4).default(1),
});

export type TClipToolsConfig = z.infer<typeof clipToolsSchema>;

/** Which clip tools ordinary chats offer, for the composer's «ساختن» row. */
export type TClipToolsStartupConfig = {
  clip: boolean;
};
