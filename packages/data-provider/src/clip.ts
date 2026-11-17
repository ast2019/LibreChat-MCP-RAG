import { z } from 'zod';

/** In-chat tool that builds a short branded MP4 on the HiveGPT Remotion worker. */
export enum ClipTools {
  clip = 'create_remotion_clip',
}

export const CLIP_TOOL_NAMES: readonly string[] = Object.values(ClipTools);

/** Deployment skills that declare the clip tool. */
export const CLIP_TOOL_SKILLS: Readonly<Record<ClipTools, readonly string[]>> = {
  [ClipTools.clip]: ['clip-builder', 'animation-styles'],
};

/** The file context generated clip files are stored under. */
export const CLIP_FILE_CONTEXT = 'clip_generation';

/** Key of the files a clip tool saved, on its tool artifact. */
export const CLIP_ARTIFACT_KEY = 'clip_files';

export const clipToolsSchema = z.object({
  /** Short Remotion clips from the «کلیپ‌ساز» row */
  clip: z.boolean().default(true),
  /** Longest clip the worker accepts, in seconds */
  maxDurationSec: z.number().int().min(1).max(30).default(30),
  /** Output height in pixels (width follows 9:16 or 16:9). Keep 720 to limit server load. */
  height: z.number().int().min(360).max(1080).default(720),
  /** How many Remotion renders may run at once on the worker */
  maxConcurrent: z.number().int().min(1).max(4).default(2),
});

export type TClipToolsConfig = z.infer<typeof clipToolsSchema>;

/** Which clip tools ordinary chats offer, for the composer's «ساختن» row. */
export type TClipToolsStartupConfig = {
  clip: boolean;
};
