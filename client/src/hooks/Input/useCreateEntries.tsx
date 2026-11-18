import React, { useMemo } from 'react';
import {
  ClipTools,
  CLIP_TOOL_SKILLS,
  OfficeTools,
  OFFICE_TOOL_SKILLS,
} from 'librechat-data-provider';
import {
  Wand2,
  Film,
  AudioLines,
  NotebookPen,
  Clapperboard,
  Presentation,
  SlidersHorizontal,
  Image as ImageIcon,
} from 'lucide-react';
import type {
  TMediaWayId,
  TMediaWayState,
  TClipToolsStartupConfig,
  TOfficeToolsStartupConfig,
} from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks/useLocalize';
import type { FeatureToolPatch } from './featureToolFlags';
import type { PaletteEntry } from './usePaletteEntries';
import type { StagedSkills } from './useStageSkill';
import { useMediaStatusQuery, useGetStartupConfig } from '~/data-provider';
import ExperimentalBadge from '~/components/ui/ExperimentalBadge';
import useLocalize from '~/hooks/useLocalize';

/** Composer flags that equip feature tools only after the user picks a «ساختن» row. */
export type CreateFeatureTools = {
  media: boolean;
  office: boolean;
  clip: boolean;
  /** Merge flags onto the conversation's ephemeral agent (and reconcile ask_user). */
  set: (patch: FeatureToolPatch) => void;
};

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

/** The article wizard and the slide builder: each starts its skill and its request. */
const OFFICE_WAYS: ReadonlyArray<{
  id: 'article' | 'slides';
  tool: keyof TOfficeToolsStartupConfig;
  skill: string;
  label: TranslationKeys;
  hint: TranslationKeys;
  starter: TranslationKeys;
  icon: React.ElementType;
}> = [
  {
    id: 'article',
    tool: 'word',
    skill: OFFICE_TOOL_SKILLS[OfficeTools.word][0],
    label: 'com_ui_create_article',
    hint: 'com_ui_create_article_hint',
    starter: 'com_ui_create_article_starter',
    icon: NotebookPen,
  },
  {
    id: 'slides',
    tool: 'slides',
    skill: OFFICE_TOOL_SKILLS[OfficeTools.slides][0],
    label: 'com_ui_create_slides',
    hint: 'com_ui_create_slides_hint',
    starter: 'com_ui_create_slides_starter',
    icon: Presentation,
  },
];

/** The Remotion clip builder: starts its skill and its request. */
const CLIP_WAYS: ReadonlyArray<{
  id: 'clip';
  tool: keyof TClipToolsStartupConfig;
  skill: string;
  label: TranslationKeys;
  hint: TranslationKeys;
  starter: TranslationKeys;
  icon: React.ElementType;
}> = [
  {
    id: 'clip',
    tool: 'clip',
    skill: CLIP_TOOL_SKILLS[ClipTools.clip][0],
    label: 'com_ui_create_clip',
    hint: 'com_ui_create_clip_hint',
    starter: 'com_ui_create_clip_starter',
    icon: Film,
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
 * Palette create + builder rows: image/video/audio under «ساختن», then article/slides/clip under
 * «سازندگان» (marked «آزمایشی»). An available media way equips media tools and starts the request;
 * an unavailable one, and «همه روش‌ها», open the media dialog. Builder rows equip their tools (and
 * stage their skill when skills are allowed); picking an on row turns that feature off again. Ways
 * the deployment has not set up are left out rather than offered as dead rows.
 */
export default function useCreateEntries({
  enabled,
  onCompose,
  onShowAll,
  skills,
  imageModel,
  features,
}: {
  enabled: boolean;
  /** Puts the starting words of a request into the composer and focuses it */
  onCompose: (starter: string) => void;
  onShowAll: () => void;
  /** The staged skills and turning one on or off; absent when the user cannot use skills */
  skills?: StagedSkills | null;
  /** The image model the next picture uses, and opening the picker; absent hides the row */
  imageModel?: { current?: string; onOpen: () => void } | null;
  /** Opt-in feature tool flags for this conversation; required for schemas to load */
  features?: CreateFeatureTools | null;
}): PaletteEntry[] {
  const localize = useLocalize();
  const status = useMediaStatusQuery(enabled);
  const { data: startupConfig } = useGetStartupConfig();
  const ways = status.data?.ways;
  const imageModels = status.data?.imageModels;
  const office = startupConfig?.officeTools;
  const clip = startupConfig?.clipTools;

  return useMemo(() => {
    if (!enabled) {
      return [];
    }
    const entries: PaletteEntry[] = [];
    for (const way of CREATE_WAYS) {
      const state = ways?.find((item) => item.id === way.id)?.state;
      if (state == null || state === 'not_configured') {
        continue;
      }
      const Icon = way.icon;
      const available = state === 'active';
      const equipped = features?.media === true;
      const reason = STATE_LABEL[state];
      entries.push({
        key: `create:${way.id}`,
        itemType: 'builtin',
        itemId: `create_${way.id}`,
        label: localize(way.label),
        description: available || reason == null ? localize(way.hint) : localize(reason),
        icon: <Icon className="icon-md" aria-hidden="true" />,
        section: 'create',
        active: equipped,
        pinned: false,
        favoritable: false,
        dismiss: true,
        onSelect: !available
          ? onShowAll
          : equipped
            ? () => features?.set({ media: false })
            : () => {
                features?.set({ media: true, ask_user_question: true });
                onCompose(localize(way.starter));
              },
      });
      /* The model the picture is made with, when the deployment offers more than one. */
      if (way.id === 'image' && available && imageModel != null && (imageModels?.length ?? 0) > 1) {
        const current =
          imageModels?.find((model) => model.id === imageModel.current) ??
          imageModels?.find((model) => model.default === true);
        entries.push({
          key: 'create:image_model',
          itemType: 'builtin',
          itemId: 'create_image_model',
          label: localize('com_ui_create_image_model'),
          description: current
            ? localize('com_ui_create_image_model_hint', { 0: current.name ?? current.id })
            : undefined,
          icon: <SlidersHorizontal className="icon-md" aria-hidden="true" />,
          section: 'create',
          active: false,
          pinned: false,
          favoritable: false,
          dismiss: true,
          onSelect: imageModel.onOpen,
        });
      }
    }
    for (const way of OFFICE_WAYS) {
      if (office?.[way.tool] !== true) {
        continue;
      }
      const Icon = way.icon;
      const staged = skills?.staged.includes(way.skill) === true;
      /** Stay tied to the equipped flag: submit drains staged skills but keeps
       *  `ephemeralAgent.office` so later wizard turns still have the tools. */
      const equipped = features?.office === true;
      entries.push({
        key: `create:${way.id}`,
        itemType: 'builtin',
        itemId: `create_${way.id}`,
        label: localize(way.label),
        description: localize(way.hint),
        badge: <ExperimentalBadge />,
        icon: <Icon className="icon-md" aria-hidden="true" />,
        section: 'builder',
        active: equipped,
        pinned: false,
        favoritable: false,
        dismiss: true,
        onSelect: equipped
          ? () => {
              if (staged) {
                /** `unstage` reconciles office from whatever skills remain. */
                skills?.unstage(way.skill);
              } else {
                features?.set({ office: false });
              }
            }
          : () => {
              skills?.stage(way.skill);
              features?.set({ office: true, ask_user_question: true });
              onCompose(localize(way.starter));
            },
      });
    }
    for (const way of CLIP_WAYS) {
      if (clip?.[way.tool] !== true) {
        continue;
      }
      const Icon = way.icon;
      const staged = skills?.staged.includes(way.skill) === true;
      /** Same as office: the flag outlives the drained skill chip. */
      const equipped = features?.clip === true;
      entries.push({
        key: `create:${way.id}`,
        itemType: 'builtin',
        itemId: `create_${way.id}`,
        label: localize(way.label),
        description: localize(way.hint),
        badge: <ExperimentalBadge />,
        icon: <Icon className="icon-md" aria-hidden="true" />,
        section: 'builder',
        active: equipped,
        pinned: false,
        favoritable: false,
        dismiss: true,
        onSelect: equipped
          ? () => {
              if (staged) {
                skills?.unstage(way.skill);
              } else {
                features?.set({ clip: false });
              }
            }
          : () => {
              skills?.stage(way.skill);
              features?.set({ clip: true, ask_user_question: true });
              onCompose(localize(way.starter));
            },
      });
    }
    if (ways != null) {
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
    }
    return entries;
  }, [
    enabled,
    ways,
    imageModels,
    imageModel,
    office,
    clip,
    localize,
    onCompose,
    onShowAll,
    skills,
    features,
  ]);
}
