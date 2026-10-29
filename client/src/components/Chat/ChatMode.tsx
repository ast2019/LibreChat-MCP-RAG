import { Crown, Server, ShieldCheck } from 'lucide-react';
import { Chip } from '@librechat/client';
import type { LucideIcon } from 'lucide-react';
import type { ChatMode } from '~/hooks/Chat/useChatMode';
import type { TranslationKeys } from '~/hooks';
import useChatMode from '~/hooks/Chat/useChatMode';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface ChatModeLook {
  icon: LucideIcon;
  label: TranslationKeys;
  hint: TranslationKeys;
  /** The chip's edge, fill and icon. Text stays on the primary ink so it reads at AA. */
  chip: string;
  iconClass: string;
  /** The composer's edge and tint, layered over its opaque surface like Temporary Chat. */
  composer: string;
}

/**
 * One categorical series slot per mode, so each follows the theme and stays apart from
 * Temporary Chat's `series-6` purple: teal for confidential, green for local, gold for admin.
 * Admin gets a two-tone wash and a solid edge; the other two a quiet half-alpha edge.
 */
export const chatModeLooks: Record<ChatMode, ChatModeLook> = {
  confidential: {
    icon: ShieldCheck,
    label: 'com_ui_chat_mode_confidential',
    hint: 'com_ui_chat_mode_confidential_hint',
    chip: 'border-series-3/50 bg-series-3/10 high-contrast:border-series-3',
    iconClass: 'text-series-3',
    composer:
      'border-series-3/50 from-series-3/8 to-series-3/8 high-contrast:border-series-3 bg-linear-to-b',
  },
  local: {
    icon: Server,
    label: 'com_ui_chat_mode_local',
    hint: 'com_ui_chat_mode_local_hint',
    chip: 'border-series-7/60 bg-series-7/12 high-contrast:border-series-7',
    iconClass: 'text-series-7',
    composer:
      'border-series-7/60 from-series-7/12 to-series-7/5 high-contrast:border-series-7 bg-linear-to-b',
  },
  admin: {
    icon: Crown,
    label: 'com_ui_chat_mode_admin',
    hint: 'com_ui_chat_mode_admin_hint',
    chip: 'border-series-4 from-series-4/20 to-series-2/15 bg-linear-to-l font-semibold',
    iconClass: 'text-series-4',
    composer:
      'border-series-4 from-series-4/15 to-series-2/8 ring-series-4/20 bg-linear-to-b ring-4',
  },
};

/** The persistent header cue for a confidential, local or admin chat. `role="status"` tells
 *  assistive technology when the mode changes; below `md` only the icon shows. */
export function ChatModeIndicator() {
  const localize = useLocalize();
  const mode = useChatMode();
  if (!mode) {
    return null;
  }
  const look = chatModeLooks[mode];
  const Icon = look.icon;
  return (
    <Chip
      role="status"
      tone="surface"
      size="theme"
      shape="theme"
      data-chat-mode={mode}
      title={localize(look.hint)}
      className={cn('text-text-primary shrink-0', look.chip)}
      leading={<Icon className={cn('size-4 shrink-0', look.iconClass)} aria-hidden="true" />}
    >
      <span className="max-md:sr-only">{localize(look.label)}</span>
    </Chip>
  );
}

/** The welcome screen's statement of the mode, under the greeting. */
export function ChatModeBadge({ mode }: { mode: ChatMode }) {
  const localize = useLocalize();
  const look = chatModeLooks[mode];
  const Icon = look.icon;
  return (
    <div
      data-testid="chat-mode-badge"
      data-chat-mode={mode}
      className={cn(
        'animate-fadeIn text-text-primary mt-4 flex max-w-md items-center gap-2 rounded-full border px-4 py-2 text-sm',
        look.chip,
      )}
    >
      <Icon className={cn('size-4 shrink-0', look.iconClass)} aria-hidden="true" />
      <span className="font-semibold">{localize(look.label)}</span>
      <span className="text-text-secondary">{localize(look.hint)}</span>
    </div>
  );
}
