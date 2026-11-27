import { useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { Button, Spinner, Textarea } from '@librechat/client';
import type { TClipWizardConfigResponse, TClipWizardErrorCode } from 'librechat-data-provider';
import type { ClipWizardStoryboardState } from '~/store/clipWizard';
import {
  clipWizardChatAtom,
  clipWizardImagesAtom,
  clipWizardSettingsAtom,
  clipWizardStoryboardAtom,
  clipWizardTopicAtom,
} from '~/store/clipWizard';
import { useChatClipWizardMutation } from '~/data-provider';
import { clipWizardErrorCode } from './errors';
import { useClipWizardModel } from './Model';
import { useLocalize } from '~/hooks';
import Notice from './Notice';
import Model from './Model';

/** A chat with the model about this clip, beside every step. It never opens the normal chat. */
export default function Chat({ config }: { config: TClipWizardConfigResponse }) {
  const localize = useLocalize();
  const [messages, setMessages] = useAtom(clipWizardChatAtom);
  const [storyboard, setStoryboard] = useAtom(clipWizardStoryboardAtom);
  const topic = useAtomValue(clipWizardTopicAtom);
  const settings = useAtomValue(clipWizardSettingsAtom);
  const images = useAtomValue(clipWizardImagesAtom);
  const [modelId] = useClipWizardModel(config);
  const chat = useChatClipWizardMutation();
  const [text, setText] = useState('');
  const [error, setError] = useState<TClipWizardErrorCode | null>(null);

  const send = () => {
    const content = text.trim();
    if (!content || !storyboard || !modelId || chat.isLoading) {
      return;
    }
    const sent = { id: messages.length + 1, role: 'user' as const, content };
    const history = [...messages, sent];
    setMessages(history);
    setText('');
    setError(null);
    chat.mutate(
      {
        modelId,
        messages: history.map(({ role, content: body }) => ({ role, content: body })),
        storyboard,
        ...(topic.trim() ? { topic } : {}),
        settings: {
          aspectRatio: settings.aspectRatio,
          targetDurationSec: settings.targetDurationSec,
        },
        images,
      },
      {
        onSuccess: (result) => {
          const updated = result.storyboard != null;
          if (result.storyboard) {
            setStoryboard(result.storyboard as ClipWizardStoryboardState);
          }
          setMessages([
            ...history,
            { id: history.length + 1, role: 'assistant', content: result.reply, updated },
          ]);
        },
        onError: (err) => setError(clipWizardErrorCode(err)),
      },
    );
  };

  return (
    <aside
      className="border-border-light flex flex-col gap-3 rounded-lg border p-3"
      aria-labelledby="clipwizard-chat-title"
    >
      <h2 id="clipwizard-chat-title" className="text-base font-semibold">
        {localize('com_clipwizard_chat_title')}
      </h2>
      <Model config={config} />
      <div
        role="log"
        aria-live="polite"
        data-testid="clipwizard-chat-log"
        className="flex max-h-72 flex-col gap-2 overflow-y-auto"
      >
        {messages.length === 0 ? (
          <p className="text-text-secondary text-sm">{localize('com_clipwizard_chat_empty')}</p>
        ) : null}
        {messages.map((message) => (
          <div
            key={message.id}
            data-role={message.role}
            className={
              message.role === 'user'
                ? 'bg-surface-secondary rounded-lg px-3 py-2 text-sm'
                : 'border-border-light rounded-lg border px-3 py-2 text-sm'
            }
          >
            <span className="text-text-secondary block text-xs">
              {localize(
                message.role === 'user' ? 'com_clipwizard_chat_you' : 'com_clipwizard_chat_model',
              )}
            </span>
            <span className="whitespace-pre-wrap">{message.content}</span>
            {message.updated ? (
              <span
                className="text-text-secondary mt-1 block text-xs"
                data-testid="clipwizard-chat-updated"
              >
                {localize('com_clipwizard_chat_updated')}
              </span>
            ) : null}
          </div>
        ))}
        {chat.isLoading ? (
          <div
            role="status"
            className="flex items-center gap-2 text-sm"
            data-testid="clipwizard-chat-loading"
          >
            <Spinner className="size-4" />
            {localize('com_clipwizard_chat_working')}
          </div>
        ) : null}
      </div>
      {error ? <Notice code={error} /> : null}
      {!storyboard ? (
        <p className="text-text-secondary text-xs">
          {localize('com_clipwizard_chat_needs_storyboard')}
        </p>
      ) : null}
      <label className="flex flex-col gap-1 text-sm">
        {localize('com_clipwizard_chat_label')}
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={2}
          maxLength={config.limits.maxChatChars}
          disabled={!storyboard}
          placeholder={localize('com_clipwizard_chat_placeholder')}
        />
      </label>
      <div>
        <Button
          size="sm"
          onClick={send}
          disabled={!storyboard || !text.trim() || !modelId || chat.isLoading}
        >
          {localize('com_clipwizard_chat_send')}
        </Button>
      </div>
    </aside>
  );
}
