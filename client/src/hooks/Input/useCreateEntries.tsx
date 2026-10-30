import React, { useMemo } from 'react';
import { AudioLines, Clapperboard, Image as ImageIcon, Wand2 } from 'lucide-react';
import type { TMediaWayId, TMediaWayState } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks/useLocalize';
import type { PaletteEntry } from './usePaletteEntries';
import { useMediaStatusQuery } from '~/data-provider';
import useLocalize from '~/hooks/useLocalize';

/** The three ways the chat model makes media itself, in the order the palette lists them. */
const CREATE_WAYS: ReadonlyArray<{
  id: Extract<TMediaWayId, 'image' | 'video' | 'speech'>;
  label: TranslationKeys;
  hint: TranslationKeys;
  starter: TranslationKeys;
  icon: React.ElementType;
}> = [
  {
    id: 'image',
    label: 'com_media_way_image',
    hint: 'com_ui_create_image_hint',
    starter: 'com_ui_create_image_starter',
    icon: ImageIcon,
  },
  {
    id: 'video',
    label: 'com_media_way_video',
    hint: 'com_ui_create_video_hint',
    starter: 'com_ui_create_video_starter',
    icon: Clapperboard,
  },
  {
    id: 'speech',
    label: 'com_media_way_speech',
    hint: 'com_ui_create_speech_hint',
    starter: 'com_ui_create_speech_starter',
    icon: AudioLines,
  },
];

/** Why a way is off, in the same words the media dialog uses. */
const STATE_LABEL: Partial<Record<TMediaWayState, TranslationKeys>> = {
  needs_pack: 'com_media_state_needs_pack',
  disabled_by_admin: 'com_media_state_disabled',
  not_allowed: 'com_media_state_not_allowed',
  needs_connection: 'com_media_state_needs_connection',
  owner_not_connected: 'com_media_state_owner',
};

/**
 * The palette's «ساختن» rows: image, video and audio, each with the reason it is off when it is.
 * An available way starts the request in the composer; an unavailable one, and «همه روش‌ها»,
 * open the media dialog that says what turns it on. Ways the deployment has not set up are left
 * out rather than offered as dead rows.
 */
export default function useCreateEntries({
  enabled,
  onCompose,
  onShowAll,
}: {
  enabled: boolean;
  /** Puts the starting words of a request into the composer and focuses it */
  onCompose: (starter: string) => void;
  onShowAll: () => void;
}): PaletteEntry[] {
  const localize = useLocalize();
  const status = useMediaStatusQuery(enabled);
  const ways = status.data?.ways;

  return useMemo(() => {
    if (!enabled || ways == null) {
      return [];
    }
    const entries: PaletteEntry[] = [];
    for (const way of CREATE_WAYS) {
      const state = ways.find((item) => item.id === way.id)?.state;
      if (state == null || state === 'not_configured') {
        continue;
      }
      const Icon = way.icon;
      const active = state === 'active';
      const reason = STATE_LABEL[state];
      entries.push({
        key: `create:${way.id}`,
        itemType: 'builtin',
        itemId: `create_${way.id}`,
        label: localize(way.label),
        description: active || reason == null ? localize(way.hint) : localize(reason),
        icon: <Icon className="icon-md" aria-hidden="true" />,
        section: 'create',
        active: false,
        pinned: false,
        favoritable: false,
        dismiss: true,
        onSelect: active ? () => onCompose(localize(way.starter)) : onShowAll,
      });
    }
    entries.push({
      key: 'create:all',
      itemType: 'builtin',
      itemId: 'create_all',
      label: localize('com_ui_create_all_ways'),
      description: localize('com_ui_create_all_ways_hint'),
      icon: <Wand2 className="icon-md" aria-hidden="true" />,
      section: 'create',
      active: false,
      pinned: false,
      favoritable: false,
      dismiss: true,
      onSelect: onShowAll,
    });
    return entries;
  }, [enabled, ways, localize, onCompose, onShowAll]);
}
