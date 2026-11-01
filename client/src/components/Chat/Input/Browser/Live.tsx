import { useContext, useEffect, useRef, useState } from 'react';
import { Button, Input, Spinner, useToastContext } from '@librechat/client';
import type { TBrowserInput, TBrowserSessionView } from 'librechat-data-provider';
import type { BrowserLiveState } from '~/data-provider/Browser/useBrowserLiveView';
import type { TranslationKeys } from '~/hooks';
import {
  useBrowserLiveView,
  useBrowserInputMutation,
  useBrowserControlMutation,
} from '~/data-provider';
import { ChatContext } from '~/Providers/ChatContext';
import { useLocalize } from '~/hooks';

const SCROLL_FLUSH_MS = 150;

const HANDOFF_KEYS: Record<NonNullable<TBrowserSessionView['handoff']>['reason'], TranslationKeys> =
  {
    login: 'com_ui_browser_handoff_login',
    captcha: 'com_ui_browser_handoff_captcha',
    payment: 'com_ui_browser_handoff_payment',
    confirm: 'com_ui_browser_handoff_confirm',
    other: 'com_ui_browser_handoff_other',
  };

const KEYS: ReadonlyArray<{ key: 'Enter' | 'Tab' | 'Backspace'; label: TranslationKeys }> = [
  { key: 'Enter', label: 'com_ui_browser_key_enter' },
  { key: 'Tab', label: 'com_ui_browser_key_tab' },
  { key: 'Backspace', label: 'com_ui_browser_key_backspace' },
];

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * The live view of the chat's browser. The page streams in as frames; while the model has the
 * browser the user watches, and can take it over. While the user has it, a click on the frame
 * clicks the page at that point, and the field below types into whatever was clicked (hidden
 * when it is a password). «تمام شد، ادامه بده» gives the browser back and tells the model so.
 */
export default function Live({
  id,
  session,
  conversationId,
  onState,
  onClosed,
}: {
  id: string;
  session: TBrowserSessionView;
  conversationId: string | null | undefined;
  onState: (state: BrowserLiveState) => void;
  onClosed: () => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const chat = useContext(ChatContext);
  const { frame, connected } = useBrowserLiveView(session.id, true, { onState, onClosed });
  const input = useBrowserInputMutation();
  const control = useBrowserControlMutation(conversationId);
  const [text, setText] = useState('');
  const [secret, setSecret] = useState(false);
  const scrolled = useRef(0);
  const scrollTimer = useRef<ReturnType<typeof setTimeout>>();
  const userHasIt = session.control === 'user';

  useEffect(() => () => clearTimeout(scrollTimer.current), []);

  const send = (payload: TBrowserInput) =>
    input.mutate(
      { sessionId: session.id, input: payload },
      {
        onSuccess: (result) => {
          if (payload.type === 'click') {
            setSecret(result.focus === 'password');
          }
        },
        onError: () =>
          showToast({ status: 'error', message: localize('com_ui_browser_input_error') }),
      },
    );

  /* Keyboard activation has no point on the page, so only pointer clicks are forwarded. */
  const click = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!userHasIt || frame == null || event.detail === 0) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return;
    }
    send({
      type: 'click',
      x: Math.round(((event.clientX - rect.left) / rect.width) * frame.width),
      y: Math.round(((event.clientY - rect.top) / rect.height) * frame.height),
    });
  };

  const wheel = (event: React.WheelEvent<HTMLButtonElement>) => {
    if (!userHasIt) {
      return;
    }
    scrolled.current += event.deltaY;
    if (scrollTimer.current != null) {
      return;
    }
    scrollTimer.current = setTimeout(() => {
      const dy = Math.round(scrolled.current);
      scrolled.current = 0;
      scrollTimer.current = undefined;
      if (dy !== 0) {
        send({ type: 'scroll', dy });
      }
    }, SCROLL_FLUSH_MS);
  };

  const sendText = () => {
    if (text === '') {
      return;
    }
    send({ type: 'type', text });
    setText('');
  };

  /**
   * Enter in the field types its text into the page, like «ارسال متن», and goes no further.
   * The live view sits inside the chat's form: a form of its own here would hand its submit
   * to the chat's, which sent the chat message and left the page mid sign-in. Pressing the
   * page's own Enter (to submit a site's form) stays the explicit «Enter» button.
   */
  const typeKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const composing = event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
    if (!composing && !event.repeat) {
      sendText();
    }
  };

  const controlError = () =>
    showToast({ status: 'error', message: localize('com_ui_browser_control_error') });

  const take = () =>
    control.mutate({ sessionId: session.id, to: 'user' }, { onError: controlError });

  const finish = () =>
    control.mutate(
      { sessionId: session.id, to: 'model' },
      {
        onSuccess: () => {
          if (chat != null && !chat.isSubmitting) {
            chat.ask(
              { text: localize('com_ui_browser_continue_message') },
              { overrideFiles: [], overrideQuotes: [], overrideManualSkills: [] },
            );
          }
        },
        onError: controlError,
      },
    );

  const handoff = session.handoff;

  return (
    <div id={id} className="mt-2 space-y-2" data-testid="browser-live">
      {userHasIt && (
        <div
          role="status"
          className="border-status-warning-border bg-status-warning-subtle text-text-primary space-y-1 rounded-xl border px-3 py-2 text-sm"
        >
          <p className="font-medium">
            {localize(handoff ? HANDOFF_KEYS[handoff.reason] : 'com_ui_browser_you_have_it')}
          </p>
          {handoff?.message && <p dir="auto">{handoff.message}</p>}
          <p className="text-text-secondary text-xs">{localize('com_ui_browser_private_hint')}</p>
        </div>
      )}

      <button
        type="button"
        onClick={click}
        onWheel={wheel}
        disabled={!userHasIt}
        aria-label={localize(userHasIt ? 'com_ui_browser_page_click' : 'com_ui_browser_page')}
        data-testid="browser-frame"
        className="border-border-light block w-full overflow-hidden rounded-xl border disabled:cursor-default"
      >
        {frame ? (
          <img
            src={`data:image/jpeg;base64,${frame.data}`}
            alt={session.title || hostOf(session.url)}
            draggable={false}
            className="block h-auto w-full select-none"
          />
        ) : (
          <span className="flex aspect-video items-center justify-center">
            <Spinner className="size-5" />
            <span className="sr-only">{localize('com_ui_browser_connecting')}</span>
          </span>
        )}
      </button>

      {userHasIt ? (
        <>
          <div role="group" className="flex flex-wrap items-center gap-2">
            <Input
              type={secret ? 'password' : 'text'}
              dir="auto"
              autoComplete="off"
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={typeKeyDown}
              enterKeyHint="send"
              placeholder={localize('com_ui_browser_type_placeholder')}
              aria-label={localize('com_ui_browser_type')}
              data-testid="browser-type"
              className="min-w-40 flex-1"
            />
            <Button
              type="button"
              size="compact"
              variant="outline"
              disabled={text === ''}
              onClick={sendText}
            >
              {localize('com_ui_browser_send_text')}
            </Button>
            {KEYS.map(({ key, label }) => (
              <Button
                key={key}
                type="button"
                size="compact"
                variant="outline"
                onClick={() => send({ type: 'key', key })}
              >
                {localize(label)}
              </Button>
            ))}
            <Button
              type="button"
              size="compact"
              variant="outline"
              onClick={() => send({ type: 'back' })}
            >
              {localize('com_ui_browser_back')}
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-text-secondary text-xs">{localize('com_ui_browser_click_hint')}</p>
            <Button size="compact" onClick={finish} disabled={control.isLoading}>
              {localize(
                chat?.isSubmitting === true ? 'com_ui_browser_give_back' : 'com_ui_browser_done',
              )}
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-text-secondary text-xs" aria-live="polite">
            {localize(connected ? 'com_ui_browser_model_working' : 'com_ui_browser_connecting')}
          </p>
          <Button size="compact" variant="outline" onClick={take} disabled={control.isLoading}>
            {localize('com_ui_browser_take')}
          </Button>
        </div>
      )}
    </div>
  );
}
