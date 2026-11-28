import { logger } from '@librechat/data-schemas';
import { clipWizardPreviewRequestSchema } from 'librechat-data-provider';
import type { TClipWizardPreviewResponse } from 'librechat-data-provider';
import type { ClipWizardDeps, WizardReply, WizardErrorBody } from './types';
import type { WorkerJobRequest } from '../scene';
import type { ServerRequest } from '~/types';
import { createRemotionServiceClient, RemotionServiceError } from '../client';
import { getRemotionServiceTarget } from '../config';
import { recordClipEvent } from '../diagnostics';
import { parseClipInput } from '../scene';
import { resolveImages } from './effect';
import { openWizard } from './access';
import { toIssue } from './validate';
import { fail } from './types';

/** A 1x1 grey PNG standing in for AI and stock images in a preview (nothing is generated). */
const PLACEHOLDER_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNoaGgAAAMEAYFL09IQAAAAAElFTkSuQmCC';

/**
 * Calls the worker's `/stills`: the deps' own function in tests, else the worker client. Null
 * when the render service is not configured.
 */
export function stillsOf(
  deps: Pick<ClipWizardDeps, 'stills' | 'env'>,
): ((input: WorkerJobRequest) => ReturnType<NonNullable<ClipWizardDeps['stills']>>) | null {
  if (deps.stills) {
    return deps.stills;
  }
  const target = getRemotionServiceTarget(deps.env ?? process.env);
  if (!target) {
    return null;
  }
  const client = createRemotionServiceClient(target);
  return (input) => client.stills(input);
}

/** The wizard's refusal for a worker failure: a busy preview slot says busy, the rest failed. */
export function stillsFailure(error: unknown): WizardReply<WizardErrorBody> {
  if (error instanceof RemotionServiceError && error.code === 'busy') {
    return fail('busy');
  }
  return fail(error instanceof RemotionServiceError ? 'provider_failed' : 'server_error');
}

/**
 * POST preview: renders one key frame per scene (up to `clipTools.previewStills`) on the render
 * worker, so the user sees the clip before the full render. Nothing is charged: AI and stock
 * images are shown as grey placeholders and no narration is made. The worker stops at
 * `clipTools.previewTimeoutSec`.
 */
export async function previewWizardStoryboard(
  req: ServerRequest,
  deps: ClipWizardDeps,
): Promise<WizardReply<TClipWizardPreviewResponse | WizardErrorBody>> {
  const gate = await openWizard(req, deps);
  if (!gate.ok) {
    return gate.reply;
  }
  if (!gate.config.preview) {
    return fail('unavailable');
  }
  const stills = stillsOf(deps);
  if (!stills) {
    return fail('unavailable');
  }
  const body = clipWizardPreviewRequestSchema.safeParse(req.body);
  if (!body.success) {
    return fail('invalid_request');
  }
  const { storyboard, settings } = body.data;
  const resolved = resolveImages(req, gate.config, deps, settings.images);
  if (!resolved.ok) {
    return resolved.reply;
  }
  const { config } = resolved.value;
  const parsed = parseClipInput(
    {
      ...storyboard,
      ...(settings.aspectRatio ? { aspect_ratio: settings.aspectRatio } : {}),
      audio: { mode: 'none' },
      preview: true,
    },
    config,
  );
  if ('errors' in parsed) {
    return fail('invalid_storyboard', parsed.errors.map(toIssue));
  }
  try {
    const assets: WorkerJobRequest['assets'] = {};
    for (const ref of parsed.images) {
      const file = ref.source === 'file' ? await deps.loadImage(req, ref.fileId) : null;
      assets[ref.id] = file
        ? { kind: 'image', mime: file.type, base64: file.buffer.toString('base64') }
        : { kind: 'image', mime: 'image/png', base64: PLACEHOLDER_PNG };
    }
    const made = await stills({
      storyboard: parsed.storyboard,
      assets,
      audio: { mode: 'none' },
      shortSide: config.height,
      maxDurationSec: config.maxDurationSec,
      timeoutMs: config.previewTimeoutSec * 1000,
      stills: config.previewStills,
    });
    recordClipEvent({
      event: 'preview.ok',
      stills: made.stills.length,
      warnings: made.warnings.length,
    });
    return {
      status: 200,
      body: {
        stills: made.stills.map(({ frame, mime, base64 }) => ({ frame, mime, base64 })),
        notes: [...parsed.notes, ...made.warnings],
      },
    };
  } catch (error) {
    logger.error('[clip] wizard preview failed', error);
    return stillsFailure(error);
  }
}
