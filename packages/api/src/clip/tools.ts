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
 * Remotion worker (max 2 concurrent on the worker) to render at most 30s at 720p, saves the MP4
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
      return reply(
        'The clip builder is not available on this deployment (the Remotion worker is not configured). Apologise and suggest trying later.',
      );
    }

    let audioBase64: string | undefined;
    let audioMime: string | undefined;
    let ttsText: string | undefined;

    if (spec.audio.mode === 'upload' && spec.audio.fileId) {
      if (!FILE_ID.test(spec.audio.fileId)) {
        return reply('Nothing was built: audio.file_id is not a valid file id.');
      }
      const audio = await deps.loadAudio(req, spec.audio.fileId);
      if (!audio) {
        return reply(
          'Nothing was built: the uploaded audio was not found. Ask the user to attach an audio file to this message and use its id.',
        );
      }
      audioBase64 = audio.buffer.toString('base64');
      audioMime = audio.type;
    } else if (spec.audio.mode === 'tts') {
      ttsText = narrationTextFromSpec(spec);
      if (!ttsText) {
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
    let rendered;
    try {
      rendered = await client.render(payload);
    } catch (error) {
      if (error instanceof RemotionServiceError) {
        if (error.code === 'busy') {
          return reply(
            'The clip queue is full right now (only two renders run at once). Tell the user to wait a moment and ask again.',
          );
        }
        logger.warn('[clip] Remotion render refused', {
          code: error.code,
          message: error.message,
        });
        return reply(
          `Nothing was built: the Remotion worker could not render this clip (${error.code}). Apologise and suggest trying again.`,
        );
      }
      throw error;
    }

    const filename = clipFilename(spec.title, spec.version);
    const saved = await deps.saveMedia(req, {
      buffer: rendered.buffer,
      type: rendered.type || MP4,
      filename,
      context: CLIP_FILE_CONTEXT,
      conversationId: run?.configurable?.thread_id,
    });

    const link = mediaLink(saved);
    const parts = [
      `The clip «${filename}» is ready (${spec.durationSec}s, ${width}×${height}`,
      spec.audio.mode === 'tts' ? ', with TTS narration' : '',
      spec.audio.mode === 'upload' ? ', with the uploaded audio' : '',
      '). The chat already shows it as a video card; do not invent another download link.',
      ` Put this markdown in your reply exactly so it plays: ${link}`,
      ` To change the clip, call ${ClipTools.clip} again with the full scene and version ${spec.version + 1}.`,
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
        return reply('This builder is not available on this deployment.');
      }
      try {
        return await build(config, record(input), runnable as RunnableConfig | undefined);
      } catch (error) {
        logger.error(`[clip] ${name} failed`, error);
        return reply(
          'The clip could not be built because of an error on the server, and nothing was saved. Apologise to the user and suggest trying again.',
        );
      }
    };
  }

  const builders: Record<ClipTools, () => StructuredToolInterface> = {
    [ClipTools.clip]: () =>
      tool(
        guarded(ClipTools.clip, (config) => config.clip, async (config, input, run) => {
          const parsed = parseClipInput(input, config);
          if (typeof parsed === 'string') {
            return reply(`Nothing was built: ${parsed}`);
          }
          return renderClip(config, parsed, run);
        }),
        { ...clipToolDefinitions[ClipTools.clip] } as never,
      ) as unknown as StructuredToolInterface,
  };

  return toolNames
    .filter((name): name is ClipTools => name in builders)
    .map((name) => builders[name]());
}
