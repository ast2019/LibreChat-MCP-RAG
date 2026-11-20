import { logger } from '@librechat/data-schemas';
import { tool } from '@librechat/agents/langchain/tools';
import { ClipTools, CLIP_ARTIFACT_KEY, CLIP_FILE_CONTEXT } from 'librechat-data-provider';
import type { StructuredToolInterface } from '@librechat/agents/langchain/tools';
import type { TClipToolsConfig } from 'librechat-data-provider';
import type { ServerRequest } from '~/types';
import { clipToolDefinitions } from './definitions';
import {
  dimensionsFor,
  narrationTextFromSpec,
  parseClipInput,
  type ClipSpec,
  type WorkerRenderRequest,
} from './scene';
import { debugTrace } from '~/debug/recorder';
import { recordClipEvent } from './diagnostics';
import { createRemotionServiceClient, RemotionServiceError } from './client';
import { getClipConfig, getRemotionServiceTarget } from './config';

const MP4 = 'video/mp4';
const FILE_ID = /^[A-Za-z0-9_-]{6,100}$/;

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
  saveMedia: (
    req: ServerRequest,
    file: {
      buffer: Buffer;
      type: string;
      filename: string;
      context: string;
      conversationId?: string;
    },
  ) => Promise<ClipFile>;
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
  fetch?: typeof fetch;
}

type TextPart = { type: 'text'; text: string };
type ToolResult = [TextPart[], { [CLIP_ARTIFACT_KEY]?: ClipFile[] }];

interface RunnableConfig {
  configurable?: { thread_id?: string };
}

const reply = (message: string): ToolResult => [[{ type: 'text', text: message }], {}];

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function clipFilename(title: string, version: number): string {
  const safe = title
    .replace(/[^\p{L}\p{N}\s_-]+/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40);
  const base = safe || 'clip';
  return version > 1 ? `${base}-v${version}.mp4` : `${base}.mp4`;
}

function mediaLink(saved: ClipFile): string {
  return `[🎬 clip](${saved.filepath})`;
}

/**
 * Short Remotion clips. Each call validates the scene, optionally loads upload audio, asks the
 * Remotion worker to render at most 30s at 720p, saves the MP4
 * and attaches it. Building a clip does not charge credits; only the conversation's tokens apply.
 */
export function createClipTools(
  { req, toolNames }: { req: ServerRequest; toolNames: readonly string[] },
  deps: ClipToolDeps,
): StructuredToolInterface[] {
  const doFetch = deps.fetch ?? fetch;

  async function renderClip(
    config: TClipToolsConfig,
    spec: ClipSpec,
    run: RunnableConfig | undefined,
  ): Promise<ToolResult> {
    const target = getRemotionServiceTarget();
    if (!target) {
      logger.warn('[clip] tool.unconfigured: REMOTION_SERVICE_URL/TOKEN missing or invalid');
      recordClipEvent({ event: 'tool.unconfigured', level: 'warn' });
      return reply(
        'The clip builder is not available on this deployment (the Remotion worker is not configured). Apologise and suggest trying later.',
      );
    }

    let audioBase64: string | undefined;
    let audioMime: string | undefined;
    let ttsText: string | undefined;

    if (spec.audio.mode === 'upload' && spec.audio.fileId) {
      if (!FILE_ID.test(spec.audio.fileId)) {
        recordClipEvent({ event: 'tool.rejected', level: 'warn', reason: 'invalid_audio_file_id' });
        return reply('Nothing was built: audio.file_id is not a valid file id.');
      }
      const audio = await deps.loadAudio(req, spec.audio.fileId);
      if (!audio) {
        logger.warn('[clip] tool.rejected reason=uploaded_audio_not_found');
        recordClipEvent({
          event: 'tool.rejected',
          level: 'warn',
          reason: 'uploaded_audio_not_found',
        });
        return reply(
          'Nothing was built: the uploaded audio was not found. Ask the user to attach an audio file to this message and use its id.',
        );
      }
      audioBase64 = audio.buffer.toString('base64');
      audioMime = audio.type;
    } else if (spec.audio.mode === 'tts') {
      ttsText = narrationTextFromSpec(spec);
      if (!ttsText) {
        recordClipEvent({ event: 'tool.rejected', level: 'warn', reason: 'tts_without_text' });
        return reply(
          'Nothing was built: TTS needs narration text (audio.tts_text or scene headings/bodies).',
        );
      }
    }

    const { width, height } = dimensionsFor(spec.aspectRatio, config.height, spec.theme);
    const payload: WorkerRenderRequest = {
      title: spec.title,
      durationSec: spec.durationSec,
      width,
      height,
      fps: 30,
      theme: spec.theme,
      brandName: spec.brandName,
      brandColor: spec.brandColor,
      scenes: spec.scenes,
      ...(audioBase64 ? { audioBase64, audioMime } : {}),
      ...(ttsText ? { ttsText, ttsVoice: spec.audio.voice } : {}),
    };

    const client = createRemotionServiceClient(target, doFetch);
    const audioMode = spec.audio.mode;
    logger.info(
      `[clip] tool.invoked theme=${spec.theme} scenes=${spec.scenes.length} durationSec=${spec.durationSec} audio=${audioMode} version=${spec.version}`,
    );
    recordClipEvent({
      event: 'tool.invoked',
      theme: spec.theme,
      scenes: spec.scenes.length,
      durationSec: spec.durationSec,
      audio: audioMode,
      version: spec.version,
    });
    debugTrace('clip.render', {
      phase: 'start',
      theme: spec.theme,
      scenes: spec.scenes.length,
      durationSec: spec.durationSec,
      audio: audioMode,
      width,
      height,
    });
    const started = Date.now();
    let rendered;
    try {
      rendered = await client.render(payload);
    } catch (error) {
      if (error instanceof RemotionServiceError) {
        const ms = Date.now() - started;
        const fields = {
          code: error.code,
          status: error.status,
          stage: error.stage,
          jobId: error.jobId,
          detail: error.detail,
          message: error.message,
          ms,
        };
        recordClipEvent({ event: 'worker.error', level: 'warn', ...fields });
        debugTrace('clip.render', { phase: 'error', ...fields });
        if (error.code === 'busy') {
          logger.warn(
            `[clip] worker.error code=busy status=${error.status} jobId=${error.jobId ?? '-'} ms=${ms}`,
          );
          return reply(
            'The clip queue is full right now (the worker renders one clip at a time). Tell the user to wait a moment and ask again.',
          );
        }
        logger.warn(
          `[clip] worker.error code=${error.code} status=${error.status} stage=${error.stage ?? '-'} jobId=${error.jobId ?? '-'} ms=${ms} message=${error.message}${error.detail ? ` detail=${error.detail}` : ''}`,
        );
        return reply(
          `Nothing was built: the Remotion worker could not render this clip (code ${error.code}${error.stage ? `, stage ${error.stage}` : ''}). Tell the user the code, apologise and suggest trying again.`,
        );
      }
      throw error;
    }

    const renderMs = Date.now() - started;
    logger.info(
      `[clip] worker.call ok jobId=${rendered.jobId ?? '-'} ms=${renderMs} bytes=${rendered.buffer.length} durationSec=${rendered.durationSec} warnings=${rendered.warnings.length}`,
    );
    recordClipEvent({
      event: 'worker.call',
      ms: renderMs,
      bytes: rendered.buffer.length,
      durationSec: rendered.durationSec,
      jobId: rendered.jobId,
      warnings: rendered.warnings.length,
    });
    for (const warning of rendered.warnings) {
      logger.warn(`[clip] worker.warning jobId=${rendered.jobId ?? '-'} ${warning}`);
      recordClipEvent({
        event: 'worker.warning',
        level: 'warn',
        jobId: rendered.jobId,
        message: warning,
      });
    }

    const filename = clipFilename(spec.title, spec.version);
    const saveStarted = Date.now();
    const saved = await deps.saveMedia(req, {
      buffer: rendered.buffer,
      type: rendered.type || MP4,
      filename,
      context: CLIP_FILE_CONTEXT,
      conversationId: run?.configurable?.thread_id,
    });

    logger.info(`[clip] tool.saved bytes=${saved.bytes} ms=${Date.now() - saveStarted}`);
    recordClipEvent({ event: 'tool.saved', bytes: saved.bytes, ms: Date.now() - saveStarted });
    debugTrace('clip.render', {
      phase: 'end',
      ms: Date.now() - started,
      bytes: saved.bytes,
      durationSec: rendered.durationSec,
      warnings: rendered.warnings.length,
    });

    const link = mediaLink(saved);
    const warningNote = rendered.warnings.length
      ? ` Worker warnings: ${rendered.warnings.join('; ')}.${
          rendered.warnings.some((w) => w.startsWith('tts_failed'))
            ? ' The clip has NO voice (narration failed): tell the user.'
            : ''
        }`
      : '';
    const parts = [
      `The clip «${filename}» is ready (${rendered.durationSec}s, ${width}×${height}`,
      spec.audio.mode === 'tts' ? ', with TTS narration' : '',
      spec.audio.mode === 'upload' ? ', with the uploaded audio' : '',
      '). The chat already shows it as a video card; do not invent another download link.',
      ` Put this markdown in your reply exactly so it plays: ${link}`,
      ` To change the clip, call ${ClipTools.clip} again with the full scene and version ${spec.version + 1}.`,
      warningNote,
    ];
    return [[{ type: 'text', text: parts.join('') }], { [CLIP_ARTIFACT_KEY]: [saved] }];
  }

  function guarded(
    name: ClipTools,
    enabled: (config: TClipToolsConfig) => boolean,
    build: (
      config: TClipToolsConfig,
      input: Record<string, unknown>,
      run: RunnableConfig | undefined,
    ) => Promise<ToolResult>,
  ) {
    return async (input: unknown, runnable: unknown): Promise<ToolResult> => {
      const config = getClipConfig(req.config);
      if (!enabled(config) || !req.user?.id) {
        logger.warn(
          `[clip] tool.unavailable name=${name} enabled=${enabled(config)} user=${Boolean(req.user?.id)}`,
        );
        recordClipEvent({
          event: 'tool.unconfigured',
          level: 'warn',
          reason: 'disabled_or_no_user',
        });
        return reply('This builder is not available on this deployment.');
      }
      try {
        return await build(config, record(input), runnable as RunnableConfig | undefined);
      } catch (error) {
        logger.error(`[clip] tool.exception ${name} failed`, error);
        recordClipEvent({
          event: 'tool.exception',
          level: 'error',
          name: (error as Error)?.name,
          message: (error as Error)?.message,
        });
        return reply(
          'The clip could not be built because of an error on the server, and nothing was saved. Apologise to the user and suggest trying again.',
        );
      }
    };
  }

  const builders: Record<ClipTools, () => StructuredToolInterface> = {
    [ClipTools.clip]: () =>
      tool(
        guarded(
          ClipTools.clip,
          (config) => config.clip,
          async (config, input, run) => {
            const parsed = parseClipInput(input, config);
            if (typeof parsed === 'string') {
              logger.warn(`[clip] tool.rejected reason=${parsed}`);
              recordClipEvent({ event: 'tool.rejected', level: 'warn', reason: parsed });
              debugTrace('clip.render', { phase: 'rejected', reason: parsed });
              return reply(`Nothing was built: ${parsed}`);
            }
            return renderClip(config, parsed, run);
          },
        ),
        { ...clipToolDefinitions[ClipTools.clip] } as never,
      ) as unknown as StructuredToolInterface,
  };

  return toolNames
    .filter((name): name is ClipTools => name in builders)
    .map((name) => builders[name]());
}
