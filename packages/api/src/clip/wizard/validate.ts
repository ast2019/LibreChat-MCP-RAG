import { clipWizardValidateRequestSchema } from 'librechat-data-provider';
import type { TClipWizardIssue, TClipWizardValidateResponse } from 'librechat-data-provider';
import type { ClipWizardDeps, WizardReply, WizardErrorBody } from './types';
import type { ServerRequest } from '~/types';
import { parseClipInput } from '../scene';
import { resolveImages } from './effect';
import { openWizard } from './access';
import { fail } from './types';

/** `scenes[2].data[1].value: must be a number` becomes a field and a message. */
export function toIssue(text: string): TClipWizardIssue {
  const at = text.indexOf(': ');
  return at > 0
    ? { field: text.slice(0, at), message: text.slice(at + 2) }
    : { field: '', message: text };
}

/** POST storyboard/validate: the same validator the chat tool uses, answered as field issues. */
export async function validateWizardStoryboard(
  req: ServerRequest,
  deps: Pick<ClipWizardDeps, 'findBalanceByUser' | 'images'>,
): Promise<WizardReply<TClipWizardValidateResponse | WizardErrorBody>> {
  const gate = await openWizard(req, deps);
  if (!gate.ok) {
    return gate.reply;
  }
  const body = clipWizardValidateRequestSchema.safeParse(req.body);
  if (!body.success) {
    return fail('invalid_request');
  }
  const resolved = resolveImages(req, gate.config, deps, body.data.images);
  if (!resolved.ok) {
    return resolved.reply;
  }
  const parsed = parseClipInput({ ...body.data.storyboard, preview: false }, resolved.value.config);
  if ('errors' in parsed) {
    return { status: 200, body: { ok: false, issues: parsed.errors.map(toIssue) } };
  }
  return {
    status: 200,
    body: {
      ok: true,
      durationSec: parsed.durationSec,
      scenes: parsed.storyboard.scenes.length,
      notes: parsed.notes,
    },
  };
}
