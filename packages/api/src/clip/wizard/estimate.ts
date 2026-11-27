import { clipWizardEstimateRequestSchema } from 'librechat-data-provider';
import type { TClipWizardEstimateResponse } from 'librechat-data-provider';
import type { ClipWizardDeps, WizardReply, WizardErrorBody } from './types';
import type { ServerRequest } from '~/types';
import { parseClipInput } from '../scene';
import { resolveImages, imageRefusalCode } from './effect';
import { openWizard } from './access';
import { toIssue } from './validate';
import { fail } from './types';

/** POST estimate: the credits a storyboard's narration and AI images come to, before render. */
export async function estimateStoryboard(
  req: ServerRequest,
  deps: ClipWizardDeps,
): Promise<WizardReply<TClipWizardEstimateResponse | WizardErrorBody>> {
  const gate = await openWizard(req, deps);
  if (!gate.ok) {
    return gate.reply;
  }
  const body = clipWizardEstimateRequestSchema.safeParse(req.body);
  if (!body.success) {
    return fail('invalid_request');
  }
  const { storyboard, settings } = body.data;
  const resolved = resolveImages(req, gate.config, deps, settings.images);
  if (!resolved.ok) {
    return resolved.reply;
  }
  const { config, pick, capCredits } = resolved.value;
  const voice = settings.voiceId ? { mode: 'tts', voice: settings.voiceId } : { mode: 'none' };
  const parsed = parseClipInput(
    {
      ...storyboard,
      ...(settings.aspectRatio ? { aspect_ratio: settings.aspectRatio } : {}),
      audio: voice,
      preview: false,
    },
    config,
  );
  if ('errors' in parsed) {
    return { status: 200, body: { ok: false, issues: parsed.errors.map(toIssue) } };
  }

  let narrationCredits = 0;
  const narrationVoice = parsed.audio.narration;
  if (narrationVoice && deps.narration) {
    const lines = parsed.storyboard.scenes.flatMap((scene) =>
      typeof scene.narration === 'string' ? [scene.narration] : [],
    );
    const narration = deps.narration.estimate?.(req, lines, narrationVoice);
    if (narration?.ok) {
      narrationCredits = narration.credits;
    }
  }

  const imageCount = parsed.images.filter((image) => image.source === 'ai').length;
  let imageCredits = 0;
  if (imageCount > 0 && deps.images) {
    const images = deps.images.estimate?.(req, imageCount, pick);
    if (!images?.ok) {
      return fail(imageRefusalCode(images?.code));
    }
    imageCredits = images.total;
  }

  return {
    status: 200,
    body: {
      ok: true,
      items: { narrationCredits, imageCredits },
      imageCount,
      totalCredits: narrationCredits + imageCredits,
      ...(capCredits ? { capCredits } : {}),
    },
  };
}
