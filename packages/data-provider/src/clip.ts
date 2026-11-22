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
  /** Narration with word-synced captions */
  captions: z.boolean().default(true),
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
