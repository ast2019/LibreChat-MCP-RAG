import { clipWizardDraftRequestSchema, clipWizardChatRequestSchema } from 'librechat-data-provider';
import type { TClipWizardChatResponse, TClipWizardDraftResponse } from 'librechat-data-provider';
import type { ClipWizardDeps, WizardReply, WizardErrorBody } from './types';
import type { ServerRequest } from '~/types';
import { chatSystem, draftSystem, draftUser } from './prompt';
import { chatParser, draftParser } from './board';
import { resolveImages } from './effect';
import { findWizardModel } from './models';
import { openWizard } from './access';
import { fail } from './types';

/** POST draft: the model writes a storyboard from the topic and settings. */
export async function draftStoryboard(
  req: ServerRequest,
  deps: ClipWizardDeps,
): Promise<WizardReply<TClipWizardDraftResponse | WizardErrorBody>> {
  const gate = await openWizard(req, deps);
  if (!gate.ok) {
    return gate.reply;
  }
  const body = clipWizardDraftRequestSchema.safeParse(req.body);
  if (!body.success || body.data.topic.length > gate.config.wizard.llm.maxChatChars) {
    return fail('invalid_request');
  }
  if (!deps.llm) {
    return fail('unavailable');
  }
  const { topic, settings, modelId, images } = body.data;
  const model = findWizardModel(req, gate.config, modelId);
  if (!model) {
    return fail('model_unavailable');
  }
  const resolved = resolveImages(req, gate.config, deps, images);
  if (!resolved.ok) {
    return resolved.reply;
  }
  const { config, allowed } = resolved.value;
  const result = await deps.llm.run(req, gate.config, model, {
    system: draftSystem(config, settings, allowed),
    turns: [{ role: 'user', content: draftUser(topic) }],
    parse: draftParser(config, settings.aspectRatio),
  });
  if (!result.ok) {
    return fail(result.code);
  }
  return { status: 200, body: { storyboard: result.value, credits: result.credits } };
}

/** POST chat: the model answers about the storyboard and may return an edited one. */
export async function chatStoryboard(
  req: ServerRequest,
  deps: ClipWizardDeps,
): Promise<WizardReply<TClipWizardChatResponse | WizardErrorBody>> {
  const gate = await openWizard(req, deps);
  if (!gate.ok) {
    return gate.reply;
  }
  const body = clipWizardChatRequestSchema.safeParse(req.body);
  if (!body.success) {
    return fail('invalid_request');
  }
  const { llm: settingsLlm } = gate.config.wizard;
  const { modelId, storyboard, topic, settings, images } = body.data;
  const history = body.data.messages
    .slice(-settingsLlm.chatHistoryTurns)
    .filter(
      (message, index, all) =>
        message.role === 'user' || all.slice(0, index).some((m) => m.role === 'user'),
    );
  const last = history[history.length - 1];
  if (
    !last ||
    last.role !== 'user' ||
    history.some((message) => message.content.length > settingsLlm.maxChatChars)
  ) {
    return fail('invalid_request');
  }
  if (!deps.llm) {
    return fail('unavailable');
  }
  const model = findWizardModel(req, gate.config, modelId);
  if (!model) {
    return fail('model_unavailable');
  }
  const resolved = resolveImages(req, gate.config, deps, images);
  if (!resolved.ok) {
    return resolved.reply;
  }
  const { config, allowed } = resolved.value;
  const context = `Current storyboard (data):\n${JSON.stringify(storyboard)}\n\nTopic (data):\n${(topic ?? '').slice(0, settingsLlm.maxChatChars)}`;
  const result = await deps.llm.run(req, gate.config, model, {
    system: chatSystem(config, settings, allowed),
    turns: [
      { role: 'user', content: context },
      { role: 'assistant', content: '{"reply":"Ready."}' },
      ...history,
    ],
    parse: chatParser(config, settings.aspectRatio),
  });
  if (!result.ok) {
    return fail(result.code);
  }
  return {
    status: 200,
    body: {
      reply: result.value.reply,
      storyboard: result.value.storyboard,
      credits: result.credits,
    },
  };
}
