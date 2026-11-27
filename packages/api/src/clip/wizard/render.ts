import { logger } from '@librechat/data-schemas';
import { clipWizardRenderRequestSchema } from 'librechat-data-provider';
import type { TClipWizardRenderResponse } from 'librechat-data-provider';
import type { ClipWizardDeps, WizardReply, WizardErrorBody } from './types';
import type { ServerRequest } from '~/types';
import { openWizard, renderAvailable } from './access';
import { resolveImages, imageRefusalCode } from './effect';
import { RemotionServiceError } from '../client';
import { parseClipInput } from '../scene';
import { startClipJob } from '../start';
import { toIssue } from './validate';
import { fail } from './types';

/** POST render: reserve credit, record the clip job, answer with the job the MediaJob card polls. */
export async function startWizardRender(
  req: ServerRequest,
  deps: ClipWizardDeps,
): Promise<WizardReply<TClipWizardRenderResponse | WizardErrorBody>> {
  const gate = await openWizard(req, deps);
  if (!gate.ok) {
    return gate.reply;
  }
  const env = deps.env ?? process.env;
  if (!renderAvailable(env)) {
    return fail('unavailable');
  }
  const body = clipWizardRenderRequestSchema.safeParse(req.body);
  if (!body.success) {
    return fail('invalid_request');
  }
  const { storyboard, settings } = body.data;
  const resolved = resolveImages(req, gate.config, deps, settings.images);
  if (!resolved.ok) {
    return resolved.reply;
  }
  const { config, pick, capCredits } = resolved.value;
  const input = {
    ...storyboard,
    ...(settings.aspectRatio ? { aspect_ratio: settings.aspectRatio } : {}),
    audio: settings.voiceId ? { mode: 'tts', voice: settings.voiceId } : { mode: 'none' },
    preview: false,
  };
  const parsed = parseClipInput(input, config);
  if ('errors' in parsed) {
    return fail('invalid_storyboard', parsed.errors.map(toIssue));
  }
  try {
    const started = await startClipJob(req, config, parsed, deps, env, undefined, {
      pick,
      capCredits,
    });
    if (started.ok) {
      return { status: 200, body: { jobId: started.job.id } };
    }
    switch (started.code) {
      case 'busy_parallel':
      case 'busy_per_user':
        return fail('busy');
      case 'file_missing':
        return fail('invalid_request');
      case 'ai_images_refused':
        return fail(imageRefusalCode(started.imageRefusal));
      case 'narration_refused':
        return fail(started.insufficient ? 'insufficient_credit' : 'not_allowed');
      default:
        return fail('unavailable');
    }
  } catch (error) {
    logger.error('[clip] wizard render start failed', error);
    return fail(error instanceof RemotionServiceError ? 'provider_failed' : 'server_error');
  }
}
