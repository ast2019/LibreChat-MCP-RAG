import { useEffect, useId, useState } from 'react';
import { useRecoilValue } from 'recoil';
import { Button } from '@librechat/client';
import { AppWindow, X } from 'lucide-react';
import { Constants } from 'librechat-data-provider';
import type { BrowserLiveState } from '~/data-provider/Browser/useBrowserLiveView';
import {
  useGetStartupConfig,
  useBrowserSessionQuery,
  useCloseBrowserMutation,
} from '~/data-provider';
import ExperimentalBadge from '~/components/ui/ExperimentalBadge';
import { ephemeralAgentByConvoId } from '~/store';
import Live, { hostOf } from './Live';
import { useLocalize } from '~/hooks';

/**
 * The bar above the composer while this chat has a browser open: the page it is on, who has
 * it, the live view, and closing it. It looks for a browser while the browser is on for the
 * chat, and keeps looking while one is open even after it is turned off.
 */
export default function Dock({ conversationId }: { conversationId?: string | null }) {
  const localize = useLocalize();
  const liveId = useId();
  const { data: startupConfig } = useGetStartupConfig();
  const ephemeralAgent = useRecoilValue(
    ephemeralAgentByConvoId(conversationId ?? Constants.NEW_CONVO),
  );
  const available = startupConfig?.browser?.enabled === true;
  const [keepLooking, setKeepLooking] = useState(false);
  const query = useBrowserSessionQuery(
    conversationId,
    available && (ephemeralAgent?.browser === true || keepLooking),
  );
  const session = query.data?.session ?? null;
  const close = useCloseBrowserMutation(conversationId);
  const [live, setLive] = useState<BrowserLiveState | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setKeepLooking(session != null);
  }, [session]);
  useEffect(() => {
    setLive(null);
  }, [session?.id]);

  const current = session ? { ...session, ...live } : null;
  const userHasIt = current?.control === 'user';
  /* The model handing the browser over, or the user taking it, opens the live view. */
  useEffect(() => {
    if (userHasIt) {
      setOpen(true);
    }
  }, [userHasIt]);

  if (!available || current == null) {
    return null;
  }

  return (
    <section
      aria-label={localize('com_ui_browser_dock')}
      data-testid="browser-dock"
      className="border-border-light bg-surface-secondary mx-4 mb-2 rounded-2xl border p-2"
    >
      <div className="flex min-w-0 items-center gap-2">
        <AppWindow className="text-text-secondary size-4 shrink-0" aria-hidden="true" />
        <span className="text-text-primary shrink-0 text-sm font-medium">
          {localize('com_ui_browser_agent')}
        </span>
        <ExperimentalBadge />
        <span
          dir="auto"
          title={current.url}
          className="text-text-secondary min-w-0 flex-1 truncate text-xs"
        >
          {current.title || hostOf(current.url)}
        </span>
        <span className="text-text-secondary shrink-0 text-xs" data-testid="browser-dock-control">
          {localize(userHasIt ? 'com_ui_browser_control_user' : 'com_ui_browser_control_model')}
        </span>
        <Button
          size="compact"
          variant="ghost"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={liveId}
        >
          {localize(open ? 'com_ui_browser_hide_live' : 'com_ui_browser_show_live')}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-8 shrink-0"
          onClick={() => close.mutate(current.id)}
          disabled={close.isLoading}
          aria-label={localize('com_ui_browser_close')}
          title={localize('com_ui_browser_close')}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>
      {open && (
        <Live
          id={liveId}
          session={current}
          conversationId={conversationId}
          onState={setLive}
          onClosed={() => void query.refetch()}
        />
      )}
    </section>
  );
}
