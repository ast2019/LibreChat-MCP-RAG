import { Link } from 'react-router-dom';
import { SystemRoles } from 'librechat-data-provider';
import { AudioLines, Clapperboard, Image as ImageIcon, KeyRound, Users, Wand2 } from 'lucide-react';
import {
  Button,
  Skeleton,
  OGDialog,
  OGDialogTitle,
  OGDialogHeader,
  OGDialogContent,
  OGDialogDescription,
} from '@librechat/client';
import type { TMediaWayId, TMediaWayState } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { useLocalize, useAuthContext } from '~/hooks';
import { useMediaStatusQuery } from '~/data-provider';
import { cn } from '~/utils';

const WAYS: Record<
  TMediaWayId,
  { icon: React.ElementType; title: TranslationKeys; body: TranslationKeys }
> = {
  image: { icon: ImageIcon, title: 'com_media_way_image', body: 'com_media_way_image_body' },
  video: { icon: Clapperboard, title: 'com_media_way_video', body: 'com_media_way_video_body' },
  speech: { icon: AudioLines, title: 'com_media_way_speech', body: 'com_media_way_speech_body' },
  higgsfield_api: {
    icon: Wand2,
    title: 'com_media_way_higgsfield_api',
    body: 'com_media_way_higgsfield_api_body',
  },
  higgsfield_shared: {
    icon: Users,
    title: 'com_media_way_higgsfield_shared',
    body: 'com_media_way_higgsfield_shared_body',
  },
  higgsfield_own: {
    icon: KeyRound,
    title: 'com_media_way_higgsfield_own',
    body: 'com_media_way_higgsfield_own_body',
  },
};

/** What the chip says, and what the user can do about it. */
const STATES: Record<TMediaWayState, { label: TranslationKeys; how?: TranslationKeys }> = {
  active: { label: 'com_media_state_active' },
  needs_pack: { label: 'com_media_state_needs_pack', how: 'com_media_how_buy_pack' },
  disabled_by_admin: { label: 'com_media_state_disabled', how: 'com_media_how_ask_admin' },
  not_configured: { label: 'com_media_state_not_configured' },
  needs_connection: { label: 'com_media_state_needs_connection', how: 'com_media_how_connect' },
  owner_not_connected: { label: 'com_media_state_owner', how: 'com_media_how_owner' },
  not_allowed: { label: 'com_media_state_not_allowed', how: 'com_media_how_ask_admin' },
};

/** What an admin should set when a way is not configured. */
const ADMIN_SETUP: Partial<Record<TMediaWayId, TranslationKeys>> = {
  image: 'com_media_admin_setup_openrouter',
  video: 'com_media_admin_setup_openrouter',
  speech: 'com_media_admin_setup_openrouter',
  higgsfield_api: 'com_media_admin_setup_higgsfield_api',
  higgsfield_shared: 'com_media_admin_setup_higgsfield_shared',
};

function StateChip({ state }: { state: TMediaWayState }) {
  const localize = useLocalize();
  const active = state === 'active';
  return (
    <span
      className={cn(
        'shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium',
        active
          ? 'bg-status-success-subtle border-status-success-border text-text-primary'
          : 'border-border-light text-text-secondary',
      )}
    >
      {localize(STATES[state].label)}
    </span>
  );
}

/**
 * Every way to make images, videos and audio in one place: what it is, whether it is on for this
 * user, and what turns it on. The three Higgsfield routes are told apart here.
 */
export default function ToolsDialog({
  open,
  onOpenChange,
  triggerRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
}) {
  const localize = useLocalize();
  const { user } = useAuthContext();
  const status = useMediaStatusQuery(open);
  const isAdmin = user?.role === SystemRoles.ADMIN;
  const ways = status.data?.ways ?? [];

  return (
    <OGDialog open={open} onOpenChange={onOpenChange} triggerRef={triggerRef}>
      <OGDialogContent className="max-h-[90vh] w-11/12 max-w-2xl overflow-y-auto">
        <OGDialogHeader>
          <OGDialogTitle>{localize('com_media_tools_title')}</OGDialogTitle>
          <OGDialogDescription>{localize('com_media_tools_intro')}</OGDialogDescription>
        </OGDialogHeader>

        {status.isLoading && (
          <div className="space-y-2" aria-hidden="true">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        )}
        {status.isError && (
          <div className="flex flex-col items-start gap-2">
            <p role="alert" className="text-text-destructive text-sm">
              {localize('com_media_tools_error')}
            </p>
            <Button size="sm" variant="outline" onClick={() => void status.refetch()}>
              {localize('com_ui_retry')}
            </Button>
          </div>
        )}

        {ways.length > 0 && (
          <ul className="space-y-2" data-testid="media-ways">
            {ways.map((way) => {
              const meta = WAYS[way.id];
              const state = STATES[way.state];
              const Icon = meta.icon;
              const setup =
                isAdmin && way.state === 'not_configured' ? ADMIN_SETUP[way.id] : undefined;
              return (
                <li
                  key={way.id}
                  className="border-border-light flex gap-3 rounded-xl border p-3"
                  data-testid={`media-way-${way.id}`}
                >
                  <span className="bg-surface-tertiary flex size-9 shrink-0 items-center justify-center rounded-lg">
                    <Icon className="text-text-secondary size-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-text-primary text-sm font-semibold">
                        {localize(meta.title)}
                      </span>
                      <StateChip state={way.state} />
                    </div>
                    <p className="text-text-secondary text-xs">{localize(meta.body)}</p>
                    {way.models && way.models.length > 0 && (
                      <p className="text-text-tertiary text-xs" dir="ltr">
                        <bdi>{way.models.join(' · ')}</bdi>
                      </p>
                    )}
                    {state.how && (
                      <p className="text-text-primary text-xs">
                        {localize(state.how)}
                        {way.state === 'needs_pack' && (
                          <>
                            {' '}
                            <Link to="/payment" className="text-link underline">
                              {localize('com_ui_balance_buy_pack')}
                            </Link>
                          </>
                        )}
                      </p>
                    )}
                    {setup && <p className="text-text-tertiary text-xs">{localize(setup)}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-text-secondary text-xs">{localize('com_media_tools_footer')}</p>
      </OGDialogContent>
    </OGDialog>
  );
}
