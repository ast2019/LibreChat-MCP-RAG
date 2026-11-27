import { logger } from '@librechat/data-schemas';
import { ClipTools } from 'librechat-data-provider';
import { tool } from '@librechat/agents/langchain/tools';
import { TOOL_APPROVAL_EXECUTION_SCOPE_CONFIG_KEY } from '@librechat/agents';
import type { StructuredToolInterface } from '@librechat/agents/langchain/tools';
import type { TClipToolsConfig } from 'librechat-data-provider';
import type { ClipStartDeps, ClipStartResult } from './start';
import type { ClipRequest, WorkerJobRequest } from './scene';
import type { ServerRequest } from '~/types';
import { createRemotionServiceClient, RemotionServiceError } from './client';
import { getClipConfig, getRemotionServiceTarget } from './config';
import { clipToolDefinitions } from './definitions';
import { recordClipEvent } from './diagnostics';
import { debugTrace } from '~/debug/recorder';
import { mediaJobLink } from '~/media/jobs';
import { parseClipInput } from './scene';
import { startClipJob } from './start';

export { CLIP_AUDIO_TYPES, clipFilename } from './start';

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

export interface ClipToolDeps extends ClipStartDeps {
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

/** Rough render time for the card hint: one minute plus about two seconds per clip second. */
const etaMinutes = (durationSec: number): number => Math.max(1, Math.round((60 + durationSec * 2) / 60));

/** The model-facing text of a refused start. */
function refusalText(refused: Extract<ClipStartResult, { ok: false }>): string {
  switch (refused.code) {
    case 'busy_parallel':
      return `${refused.message} ${NO_RETRY}`;
    case 'busy_per_user':
      return `${refused.message} Nothing new was started. Tell the user to wait for the card in the chat to finish. ${NO_RETRY}`;
    case 'file_missing':
      return `Nothing was built: ${refused.message}`;
    case 'ai_images_unavailable':
      return 'Nothing was built: AI images are not available here. Use attached images, stock photos or icons instead.';
    case 'ai_images_refused':
      return `Nothing was built or charged: ${refused.message} Offer the user the clip without AI images (icons, their own images).`;
    case 'narration_unavailable':
      return 'Nothing was built: AI narration is not available here. Use a default voice (omit audio.voice) or audio mode "none".';
    case 'narration_refused':
      return `Nothing was built or charged: ${refused.message} Offer the user a default voice (omit audio.voice) or a clip without narration.`;
    case 'stock_off':
      return 'Nothing was built: stock photos are off on this deployment. Use attached images, icons or AI images (if offered).';
  }
}

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
    const started = await startClipJob(req, config, request, deps, env, run?.configurable?.thread_id);
    if (!started.ok) {
      return reply(refusalText(started));
    }
    const { job, payload } = started;
    instanceJob = job.id;
    if (turnKey) {
      turnJobs.set(turnKey, { jobId: job.id, expires: Date.now() + TURN_TTL_MS });
    }
    const notes = request.notes.length ? ` Notes: ${request.notes.join('; ')}.` : '';
    return reply(
      `The clip «${payload.filename}» (${request.durationSec}s, ${request.storyboard.aspectRatio}) is being rendered in the background; the chat shows a progress card that turns into the video when it is done (about ${etaMinutes(request.durationSec)} min). Put this link in your reply exactly once so the card shows: [🎬 clip](${mediaJobLink(job.id)}). Do not call create_remotion_clip again for this clip and do not retry; to change it later, call again with the full storyboard and version ${request.version + 1}.${notes}`,
    );
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
