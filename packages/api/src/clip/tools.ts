import { logger } from '@librechat/data-schemas';
import { TOOL_APPROVAL_EXECUTION_SCOPE_CONFIG_KEY } from '@librechat/agents';
import { tool } from '@librechat/agents/langchain/tools';
import { ClipTools, CLIP_FILE_CONTEXT } from 'librechat-data-provider';
import type { MediaJobCreateData, MediaJobKind, MediaJobRecord } from '@librechat/data-schemas';
import type { StructuredToolInterface } from '@librechat/agents/langchain/tools';
import type { TClipToolsConfig } from 'librechat-data-provider';
import type { ClipRequest, WorkerJobRequest } from './scene';
import type { ClipJobPayload } from './jobs';
import type { ClipNarrationHold, ClipNarrationService } from './narration';
import type { ClipImageHold, ClipImageService } from './images';
import type { ServerRequest } from '~/types';
import { createRemotionServiceClient, RemotionServiceError } from './client';
import { getClipConfig, getRemotionServiceTarget } from './config';
import { CLIP_JOB_KIND, CLIP_POLL_MS } from './jobs';
import { clipToolDefinitions } from './definitions';
import { recordClipEvent } from './diagnostics';
import { mediaJobLink } from '~/media/jobs';
import { debugTrace } from '~/debug/recorder';
import { parseClipInput } from './scene';
import { pexelsKey } from './images';

const FILE_ID = /^[A-Za-z0-9_-]{6,100}$/;
/** Audio the worker can decode (its AUDIO_EXT table in deploy/remotion/src/server.mjs). */
export const CLIP_AUDIO_TYPES: ReadonlySet<string> = new Set([
  'audio/wav',
  'audio/x-wav',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/x-m4a',
  'audio/ogg',
  'audio/webm',
]);
/**
 * Sizes assumed for images the job makes or downloads later, for the tool-time size check:
 * a generated image at the configured resolution, and a Pexels `large2x` photo.
 */
const AI_IMAGE_BYTES = 3 * 1024 * 1024;
const STOCK_IMAGE_BYTES = 2 * 1024 * 1024;
/** Spoken characters per second and WAV bytes per second (24 kHz 16-bit mono), for the same check. */
const NARRATION_CHARS_PER_SEC = 12;
const NARRATION_BYTES_PER_SEC = 48_000;
/** How long a turn's clip is remembered for the one-per-turn guard. */
const TURN_TTL_MS = 30 * 60_000;
/** A 1×1 grey PNG standing in for AI and stock images in a preview (nothing is generated). */
const PLACEHOLDER_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNoaGgAAAMEAYFL09IQAAAAAElFTkSuQmCC';

export interface ClipFile {
  file_id: string;
  filename: string;
  filepath: string;
  type: string;
  bytes: number;
  source?: string;
  user?: string;
  context?: string;
  conversationId?: string;
}

export interface ClipToolDeps {
  /** Records the clip as a background job; the clip job worker renders and delivers it. */
  createMediaJob: (data: MediaJobCreateData) => Promise<MediaJobRecord>;
  /** The user's pending jobs of a kind (one clip at a time per user by default). */
  countPendingMediaJobs: (userId: string, kind: MediaJobKind) => Promise<number>;
  /** One of the user's own images as bytes; null when missing or not theirs. */
  loadImage: (
    req: ServerRequest,
    fileId: string,
  ) => Promise<{ buffer: Buffer; type: string } | null>;
  /** One of the user's own audio files as bytes; null when missing or not audio. */
  loadAudio: (
    req: ServerRequest,
    fileId: string,
  ) => Promise<{ buffer: Buffer; type: string } | null>;
  /** AI images through the image tool's path and billing; absent when not wired */
  images?: ClipImageService;
  /** Narration by a billed speech model (voices with provider `openrouter`); absent when not wired */
  narration?: ClipNarrationService;
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
}

type TextPart = { type: 'text'; text: string };
type ImagePart = { type: 'image_url'; image_url: { url: string } };
type ToolResult = [TextPart[], { content?: ImagePart[] }];

/** The part of the tool run config the clip tool reads. */
export interface RunnableConfig {
  configurable?: { thread_id?: string; run_id?: unknown } & Record<string, unknown>;
}

const reply = (message: string): ToolResult => [[{ type: 'text', text: message }], {}];

const NO_RETRY =
  'Do not call create_remotion_clip again on your own: tell the user what happened, in their language, and ask whether to try again.';

/**
 * Users being given a clip job right now in this process. Two parallel calls for one user race
 * past the database count; this set closes that window.
 */
const creating = new Set<string>();

/**
 * Clip jobs started per turn. The agents handler builds the tools again for every tool batch,
 * so the guard lives here, keyed by the turn's response message id (from the run config), and
 * otherwise by conversation and parent message.
 */
const turnJobs = new Map<string, { jobId: string; expires: number }>();

/** The key of the turn a tool call belongs to; null when the run config names none. */
export function clipTurnKey(
  userId: string,
  run: RunnableConfig | undefined,
  req: ServerRequest,
): string | null {
  const c = run?.configurable ?? {};
  const scope = c[TOOL_APPROVAL_EXECUTION_SCOPE_CONFIG_KEY];
  if (typeof scope === 'string') {
    try {
      const [responseMessageId] = JSON.parse(scope) as unknown[];
      if (typeof responseMessageId === 'string' && responseMessageId) {
        return `${userId}:response:${responseMessageId}`;
      }
    } catch {
      // not the agents' JSON pair; try the other keys
    }
  }
  if (typeof c.run_id === 'string' && c.run_id) {
    return `${userId}:run:${c.run_id}`;
  }
  const parent = (req.body as { parentMessageId?: unknown } | undefined)?.parentMessageId;
  if (typeof c.thread_id === 'string' && typeof parent === 'string' && parent) {
    return `${userId}:parent:${c.thread_id}:${parent}`;
  }
  return null;
}

function turnJobFor(key: string | null, now = Date.now()): string | null {
  for (const [k, entry] of turnJobs) {
    if (entry.expires <= now) {
      turnJobs.delete(k);
    }
  }
  return key ? (turnJobs.get(key)?.jobId ?? null) : null;
}

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function clipFilename(title: string, version: number): string {
  const safe = title
    .replace(/[^\p{L}\p{N}\s_-]+/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40);
  const base = safe || 'clip';
  return version > 1 ? `${base}-v${version}.mp4` : `${base}.mp4`;
}

/** Rough render time for the card hint: one minute plus about two seconds per clip second. */
const etaMinutes = (durationSec: number): number => Math.max(1, Math.round((60 + durationSec * 2) / 60));

/**
 * The clip builder. A call validates the storyboard and records a background job, then answers
 * at once with the job card; rendering never holds the chat request. One clip job per turn and
 * per user at a time (configurable). `preview: true` renders a few key frames instead and
 * returns them as images.
 */
export function createClipTools(
  { req, toolNames }: { req: ServerRequest; toolNames: readonly string[] },
  deps: ClipToolDeps,
): StructuredToolInterface[] {
  const env = deps.env ?? process.env;
  /** Fallback for a run config without a turn key: this instance's own job. */
  let instanceJob: string | null = null;

  /** Files exist, audio is a format the worker reads, and the assets fit the worker's limit. */
  async function checkFiles(request: ClipRequest, config: TClipToolsConfig): Promise<string | null> {
    let bytes = 0;
    for (const ref of request.images) {
      if (ref.source === 'ai') {
        bytes += AI_IMAGE_BYTES;
        continue;
      }
      if (ref.source === 'stock') {
        bytes += STOCK_IMAGE_BYTES;
        continue;
      }
      const file = await deps.loadImage(req, ref.fileId);
      if (!file) {
        return `the image ${ref.fileId} was not found among the user's files. Use an id from the attached or generated images listed in the context.`;
      }
      bytes += file.buffer.length;
    }
    if (request.audio.mode === 'upload' && request.audio.fileId) {
      const audio = FILE_ID.test(request.audio.fileId) ? await deps.loadAudio(req, request.audio.fileId) : null;
      if (!audio) {
        return 'the uploaded audio was not found. Ask the user to attach an audio file to this message and use its id.';
      }
      if (!CLIP_AUDIO_TYPES.has(audio.type)) {
        return `the uploaded audio is ${audio.type.slice(0, 40)}, which the clip builder cannot read. Ask the user for MP3, WAV, M4A, OGG or WebM audio, or use audio mode "tts" or "none".`;
      }
      bytes += audio.buffer.length;
    }
    if (request.audio.narration) {
      const chars = request.storyboard.scenes.reduce((sum, scene) => sum + String(scene.narration ?? '').length, 0);
      bytes += Math.ceil((chars / NARRATION_CHARS_PER_SEC) * NARRATION_BYTES_PER_SEC);
    }
    const limit = config.maxAssetMb * 1024 * 1024;
    if (bytes > limit) {
      const mb = (n: number) => Math.ceil(n / 1024 / 1024);
      return `the images and audio come to about ${mb(bytes)} MB, over the ${config.maxAssetMb} MB a clip may carry. Use fewer or smaller images (or a shorter audio file) and call again.`;
    }
    return null;
  }

  async function preview(config: TClipToolsConfig, request: ClipRequest): Promise<ToolResult> {
    const target = getRemotionServiceTarget(env);
    if (!target) {
      return reply('The clip builder is not available on this deployment.');
    }
    const assets: WorkerJobRequest['assets'] = {};
    for (const ref of request.images) {
      const file = ref.source === 'file' ? await deps.loadImage(req, ref.fileId) : null;
      assets[ref.id] = file
        ? { kind: 'image', mime: file.type, base64: file.buffer.toString('base64') }
        : { kind: 'image', mime: 'image/png', base64: PLACEHOLDER_PNG };
    }
    const client = createRemotionServiceClient(target, deps.fetch);
    const { stills, warnings } = await client.stills({
      storyboard: request.storyboard,
      assets,
      audio: { mode: 'none' },
      shortSide: config.height,
      maxDurationSec: config.maxDurationSec,
      timeoutMs: config.previewTimeoutSec * 1000,
      stills: config.previewStills,
    });
    recordClipEvent({ event: 'preview.ok', stills: stills.length, warnings: warnings.length });
    const note = warnings.length ? ` Worker notes: ${warnings.join('; ')}.` : '';
    return [
      [
        {
          type: 'text',
          text: `Preview: ${stills.length} key frames (one per scene, AI and stock images shown as grey placeholders). They are shown to the user. Ask whether to render the full clip, then call again without preview.${note}`,
        },
      ],
      {
        content: stills.map((still) => ({
          type: 'image_url',
          image_url: { url: `data:${still.mime};base64,${still.base64}` },
        })),
      },
    ];
  }

  async function enqueue(
    config: TClipToolsConfig,
    request: ClipRequest,
    run: RunnableConfig | undefined,
  ): Promise<ToolResult> {
    const userId = req.user!.id;
    const turnKey = clipTurnKey(userId, run, req);
    if (turnJobFor(turnKey) ?? instanceJob) {
      recordClipEvent({ event: 'tool.busy', level: 'warn', reason: 'one_per_turn' });
      /** No job link here: the card from the first call is the only one. */
      return reply(
        'A clip job was already started in this turn. Only one clip is built per turn. Do not call create_remotion_clip again; tell the user the clip is being built and the card already in the chat will show it.',
      );
    }
    if (creating.has(userId)) {
      recordClipEvent({ event: 'tool.busy', level: 'warn', reason: 'parallel_call' });
      return reply(`Another clip for this user is being started right now. ${NO_RETRY}`);
    }
    creating.add(userId);
    let hold: ClipImageHold | undefined;
    let voiceHold: ClipNarrationHold | undefined;
    try {
      const pending = await deps.countPendingMediaJobs(userId, CLIP_JOB_KIND);
      if (pending >= config.maxJobsPerUser) {
        recordClipEvent({ event: 'tool.busy', level: 'warn', reason: 'per_user', pending });
        return reply(
          `This user already has ${pending} clip being built; a new one can start when it finishes. Nothing new was started. Tell the user to wait for the card in the chat to finish. ${NO_RETRY}`,
        );
      }
      const missing = await checkFiles(request, config);
      if (missing) {
        recordClipEvent({ event: 'tool.rejected', level: 'warn', reason: 'file_missing' });
        return reply(`Nothing was built: ${missing}`);
      }
      const conversationId = run?.configurable?.thread_id;
      const aiCount = request.images.filter((img) => img.source === 'ai').length;
      if (aiCount > 0) {
        if (!deps.images) {
          return reply('Nothing was built: AI images are not available here. Use attached images, stock photos or icons instead.');
        }
        const held = await deps.images.reserve(req, aiCount, conversationId);
        if (!held.ok) {
          recordClipEvent({ event: 'tool.rejected', level: 'warn', reason: 'ai_images_refused' });
          return reply(`Nothing was built or charged: ${held.message} Offer the user the clip without AI images (icons, their own images).`);
        }
        hold = held.hold;
      }
      if (request.audio.narration) {
        if (!deps.narration) {
          return reply('Nothing was built: AI narration is not available here. Use a default voice (omit audio.voice) or audio mode "none".');
        }
        const lines = request.storyboard.scenes.flatMap((scene) => (typeof scene.narration === 'string' ? [scene.narration] : []));
        const held = await deps.narration.reserve(req, lines, conversationId);
        if (!held.ok) {
          recordClipEvent({ event: 'tool.rejected', level: 'warn', reason: 'narration_refused' });
          return reply(`Nothing was built or charged: ${held.message} Offer the user a default voice (omit audio.voice) or a clip without narration.`);
        }
        voiceHold = held.hold;
      }
      if (request.images.some((img) => img.source === 'stock') && !pexelsKey(config.stockImages, env)) {
        return reply('Nothing was built: stock photos are off on this deployment. Use attached images, icons or AI images (if offered).');
      }
      const renderTimeoutMs = config.renderTimeoutSec * 1000;
      const payload: ClipJobPayload = {
        request,
        shortSide: config.height,
        maxDurationSec: config.maxDurationSec,
        renderTimeoutMs,
        filename: clipFilename(request.storyboard.title, request.version),
      };
      const created = Date.now();
      const job = await deps.createMediaJob({
        user: userId,
        kind: CLIP_JOB_KIND,
        provider: 'remotion',
        providerJobId: 'pending',
        providerModel: 'remotion',
        label: `${Math.round(request.durationSec)}s`,
        endpoint: 'remotion',
        context: CLIP_FILE_CONTEXT,
        ...(conversationId ? { conversationId } : {}),
        fallbackUsd: 0,
        priceMultiplier: 1,
        pollIntervalMs: CLIP_POLL_MS,
        nextPollAt: new Date(created),
        deadline: new Date(created + (config.queueTimeoutSec + config.renderTimeoutSec + 120) * 1000),
        progress: 0,
        stage: 'queued',
        payload: payload as unknown as Record<string, unknown>,
        ...(req.user?.tenantId ? { tenantId: String(req.user.tenantId) } : {}),
      });
      /** The job keeps the AI image hold until its images are made (or it ends). */
      hold?.keep(job.id, new Date(job.deadline).getTime());
      hold = undefined;
      voiceHold?.keep(job.id, new Date(job.deadline).getTime());
      voiceHold = undefined;
      instanceJob = job.id;
      if (turnKey) {
        turnJobs.set(turnKey, { jobId: job.id, expires: Date.now() + TURN_TTL_MS });
      }
      logger.info(
        `[clip] job.created job=${job.id} scenes=${request.storyboard.scenes.length} durationSec=${request.durationSec} audio=${request.audio.narration ? 'narration' : request.audio.mode} images=${request.images.length}`,
      );
      recordClipEvent({
        event: 'job.created',
        jobId: job.id,
        theme: request.storyboard.theme,
        aspect: request.storyboard.aspectRatio,
        scenes: request.storyboard.scenes.length,
        durationSec: request.durationSec,
        audio: request.audio.mode,
        images: request.images.length,
        version: request.version,
      });
      debugTrace('clip.job', { phase: 'created', scenes: request.storyboard.scenes.length, durationSec: request.durationSec });
      const notes = request.notes.length ? ` Notes: ${request.notes.join('; ')}.` : '';
      return reply(
        `The clip «${payload.filename}» (${request.durationSec}s, ${request.storyboard.aspectRatio}) is being rendered in the background; the chat shows a progress card that turns into the video when it is done (about ${etaMinutes(request.durationSec)} min). Put this link in your reply exactly once so the card shows: [🎬 clip](${mediaJobLink(job.id)}). Do not call create_remotion_clip again for this clip and do not retry; to change it later, call again with the full storyboard and version ${request.version + 1}.${notes}`,
      );
    } finally {
      creating.delete(userId);
      await hold?.release();
      await voiceHold?.release();
    }
  }

  const builders: Record<ClipTools, () => StructuredToolInterface> = {
    [ClipTools.clip]: () =>
      tool(
        async (input: unknown, runnable: unknown): Promise<ToolResult> => {
          const config = getClipConfig(req.config);
          if (!config.clip || !req.user?.id || !getRemotionServiceTarget(env)) {
            recordClipEvent({ event: 'tool.unconfigured', level: 'warn', reason: 'disabled_or_no_user' });
            return reply('The clip builder is not available on this deployment.');
          }
          try {
            const parsed = parseClipInput(record(input), config);
            if ('errors' in parsed) {
              recordClipEvent({ event: 'tool.rejected', level: 'warn', reason: 'invalid_storyboard', count: parsed.errors.length });
              debugTrace('clip.job', { phase: 'rejected', errors: parsed.errors.length });
              return reply(
                `Nothing was built: the storyboard is invalid. Fix these fields and call again:\n- ${parsed.errors.join('\n- ')}`,
              );
            }
            if (parsed.preview) {
              if (!config.preview) {
                return reply('Previews are off on this deployment; call again without preview to render.');
              }
              return await preview(config, parsed);
            }
            return await enqueue(config, parsed, runnable as RunnableConfig | undefined);
          } catch (error) {
            const code = error instanceof RemotionServiceError ? error.code : 'exception';
            logger.error(`[clip] tool.exception code=${code}`, error);
            recordClipEvent({ event: 'tool.exception', level: 'error', code, name: (error as Error)?.name });
            if (error instanceof RemotionServiceError && error.code === 'busy') {
              return reply(`The clip worker is busy right now. ${NO_RETRY}`);
            }
            return reply(`The clip could not be started because of a server error (code ${code}); nothing was saved. ${NO_RETRY}`);
          }
        },
        { ...clipToolDefinitions[ClipTools.clip] } as never,
      ) as unknown as StructuredToolInterface,
  };

  return toolNames
    .filter((name): name is ClipTools => name in builders)
    .map((name) => builders[name]());
}
