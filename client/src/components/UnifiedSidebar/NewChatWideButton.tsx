import { memo } from 'react';
import { Plus } from 'lucide-react';
import { useShortcutAriaKey } from '~/hooks/useKeyboardShortcuts';
import useNewChat from '~/hooks/Conversations/useNewChat';
import { useLocalize } from '~/hooks';

/**
 * The labelled, full-width new-chat action at the head of the chat history panel.
 * The icon rail keeps its own compact trigger; this one is the panel's primary action,
 * filled with the primary button color so it reads first when the panel opens.
 */
function NewChatWideButton() {
  const localize = useLocalize();
  const ariaKey = useShortcutAriaKey('newChat');
  const { handleNewChatClick } = useNewChat();

  return (
    <a
      href="/c/new"
      data-testid="sidebar-new-chat-button"
      aria-keyshortcuts={ariaKey}
      onClick={handleNewChatClick}
      className="bg-button-primary text-text-inverted hover:bg-button-primary-hover ring-offset-surface-primary focus-visible:ring-focus-control flex h-10 w-full items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden"
    >
      <Plus className="size-4" aria-hidden="true" />
      {localize('com_ui_new_chat')}
    </a>
  );
}

export default memo(NewChatWideButton);
