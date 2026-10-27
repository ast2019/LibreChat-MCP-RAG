import { useCallback, useMemo } from 'react';
import { useRecoilValue } from 'recoil';
import { useSearchParams } from 'react-router-dom';
import { useToastContext } from '@librechat/client';
import {
  Constants,
  EModelEndpoint,
  isAgentsEndpoint,
  isAssistantsEndpoint,
} from 'librechat-data-provider';
import type {
  TPreset,
  TModelSpec,
  TConversation,
  TAssistantsMap,
  TEndpointsConfig,
} from 'librechat-data-provider';
import type { MentionOption, ConvoGenerator } from '~/common';
import {
  clearModelForNonEphemeralAgent,
  removeUnavailableTools,
  getModelSpecIconURL,
  getConvoSwitchLogic,
  logger,
} from '~/utils';
import { useGetStartupConfig } from '~/data-provider';
import { useDefaultConvo, useLocalize } from '~/hooks';
import store from '~/store';

type SpecPrivacyList = Pick<TModelSpec, 'name' | 'privacy'>[] | null | undefined;

/** A conversation with a real id has been persisted, so it already holds messages. */
export function isPersistedConversation(conversationId?: string | null): boolean {
  return (
    typeof conversationId === 'string' &&
    conversationId !== '' &&
    conversationId !== Constants.NEW_CONVO &&
    conversationId !== 'new'
  );
}

export function isPrivateSpecName(list: SpecPrivacyList, spec?: string | null): boolean {
  if (!spec || !Array.isArray(list)) {
    return false;
  }
  return list.some((modelSpec) => modelSpec?.name === spec && modelSpec.privacy === 'private');
}

/**
 * A confidential (`privacy: 'private'`) conversation with history keeps its model:
 * changing it mid-conversation would break the work. Mirrors the server lock in
 * `checkSpecPrivacyLock` (`@librechat/api`).
 */
export function isConversationSpecLocked(
  conversation: { conversationId?: string | null; spec?: string | null } | null | undefined,
  list: SpecPrivacyList,
): boolean {
  return (
    isPersistedConversation(conversation?.conversationId) &&
    isPrivateSpecName(list, conversation?.spec)
  );
}

export default function useSelectMention({
  presets,
  modelSpecs,
  assistantsMap,
  returnHandlers,
  endpointsConfig,
  getConversation,
  newConversation,
}: {
  presets?: TPreset[];
  modelSpecs: TModelSpec[];
  returnHandlers?: boolean;
  assistantsMap?: TAssistantsMap;
  newConversation: ConvoGenerator;
  endpointsConfig: TEndpointsConfig;
  getConversation: () => TConversation | null;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data: startupConfig } = useGetStartupConfig();
  /** The full configured list (falls back to the caller's list) so a stored spec hidden
   * from the menu still resolves its privacy. */
  const privacyList = startupConfig?.modelSpecs?.list ?? modelSpecs;
  const getDefaultConversation = useDefaultConvo();
  const modularChat = useRecoilValue(store.modularChat);
  const availableTools = useRecoilValue(store.availableTools);
  const [searchParams] = useSearchParams();
  /**
   * Project scope is read from React Router's search params (the same source the
   * project chip reads), not window.location — new-chat params are written to the
   * URL via raw history.pushState, so window.location can drift out of sync.
   */
  const routeChatProjectId = useMemo(() => {
    const projectId = searchParams.get('projectId');
    return projectId != null && /^[a-f\d]{24}$/i.test(projectId) ? projectId : null;
  }, [searchParams]);

  /** Refuses (with a toast) any model change in a locked private conversation. */
  const refuseIfSpecLocked = useCallback(
    (conversation: TConversation | null, nextSpec?: string | null): boolean => {
      if (!isConversationSpecLocked(conversation, privacyList)) {
        return false;
      }
      if (nextSpec != null && nextSpec === conversation?.spec) {
        return false;
      }
      showToast({ message: localize('com_ui_private_chat_model_locked'), status: 'warning' });
      return true;
    },
    [privacyList, showToast, localize],
  );

  /**
   * Returns `true` when the selection was applied (in place or in a new conversation),
   * `false` when it was ignored or refused.
   */
  const onSelectSpec = useCallback(
    (spec?: TModelSpec): boolean => {
      if (!spec) {
        return false;
      }

      const conversation = getConversation();
      const preset = {
        ...spec.preset,
        iconURL: getModelSpecIconURL(spec),
        spec: spec.name,
      } as TPreset;
      const { endpoint } = preset;
      const newEndpoint = endpoint ?? '';
      if (!newEndpoint) {
        return false;
      }

      /* R1: a private conversation with history never changes model. */
      if (refuseIfSpecLocked(conversation, spec.name)) {
        return false;
      }

      const {
        template,
        shouldSwitch,
        isNewModular,
        newEndpointType,
        isCurrentModular,
        isExistingConversation,
      } = getConvoSwitchLogic({
        newEndpoint,
        modularChat,
        conversation,
        endpointsConfig,
      });

      if (newEndpointType) {
        preset.endpointType = newEndpointType;
      }

      if (
        isAssistantsEndpoint(newEndpoint) &&
        preset.assistant_id != null &&
        !(preset.model ?? '')
      ) {
        preset.model = assistantsMap?.[newEndpoint]?.[preset.assistant_id]?.model;
      }

      /* R2: entering a private spec from a conversation with non-private history happens
       * in a fresh conversation, so earlier messages never reach the confidential chat. */
      if (
        isPersistedConversation(conversation?.conversationId) &&
        conversation?.spec !== spec.name &&
        (spec.privacy === 'private' || isPrivateSpecName(privacyList, spec.name))
      ) {
        logger.info('conversation', 'Opening private spec in a new conversation', conversation);
        newConversation({
          template: {
            conversationId: Constants.NEW_CONVO as string,
            chatProjectId: routeChatProjectId ?? conversation?.chatProjectId ?? null,
          },
          preset,
          keepAddedConvos: false,
        });
        showToast({ message: localize('com_ui_private_chat_opened_new'), status: 'info' });
        return true;
      }

      const isModular = isCurrentModular && isNewModular && shouldSwitch;
      if (isExistingConversation && isModular) {
        template.endpointType = newEndpointType as EModelEndpoint | undefined;

        const currentConvo = getDefaultConversation({
          /* target endpointType is necessary to avoid endpoint mixing */
          conversation: { ...(conversation ?? {}), endpointType: template.endpointType },
          preset: template,
          cleanOutput: true,
        });

        /* We don't reset the latest message, only when changing settings mid-converstion */
        logger.info('conversation', 'Switching conversation to new spec (modular)', conversation);
        newConversation({
          template: currentConvo,
          preset,
          keepAddedConvos: true,
        });
        return true;
      }

      logger.info('conversation', 'Switching conversation to new spec', conversation);
      newConversation({
        template: {
          ...(template as Partial<TConversation>),
          chatProjectId: routeChatProjectId ?? conversation?.chatProjectId ?? null,
        },
        preset,
        /* A private chat never starts with a second model attached. */
        keepAddedConvos: isModular && !isPrivateSpecName(privacyList, spec.name),
      });
      return true;
    },
    [
      refuseIfSpecLocked,
      privacyList,
      showToast,
      localize,
      getConversation,
      getDefaultConversation,
      modularChat,
      newConversation,
      endpointsConfig,
      assistantsMap,
      routeChatProjectId,
    ],
  );

  type Kwargs = {
    model?: string;
    agent_id?: string;
    assistant_id?: string;
    spec?: string | null;
  };

  const onSelectEndpoint = useCallback(
    (_newEndpoint?: EModelEndpoint | string | null, kwargs: Kwargs = {}): boolean => {
      const newEndpoint = _newEndpoint ?? '';
      if (!newEndpoint) {
        return false;
      }

      const conversation = getConversation();
      /* Picking a bare endpoint/model leaves the spec, so it is a model change too. */
      if (refuseIfSpecLocked(conversation)) {
        return false;
      }

      const {
        shouldSwitch,
        isNewModular,
        isCurrentModular,
        isExistingConversation,
        newEndpointType,
        template,
      } = getConvoSwitchLogic({
        newEndpoint,
        modularChat,
        conversation,
        endpointsConfig,
      });

      const model = kwargs.model ?? '';
      if (model) {
        template.model = model;
      }

      const assistant_id = kwargs.assistant_id ?? '';
      if (assistant_id) {
        template.assistant_id = assistant_id;
      }
      const agent_id = kwargs.agent_id ?? '';
      if (agent_id) {
        template.agent_id = agent_id;
      }
      clearModelForNonEphemeralAgent(template);

      template.spec = null;
      template.iconURL = null;
      template.modelLabel = null;
      if (isExistingConversation && isCurrentModular && isNewModular && shouldSwitch) {
        template.endpointType = newEndpointType;

        const currentConvo = getDefaultConversation({
          /* target endpointType is necessary to avoid endpoint mixing */
          conversation: {
            ...(conversation ?? {}),
            spec: null,
            iconURL: null,
            modelLabel: null,
            endpointType: template.endpointType,
          },
          preset: template,
        });

        /* We don't reset the latest message, only when changing settings mid-converstion */
        logger.info(
          'conversation',
          'Switching conversation to new endpoint/model (modular)',
          currentConvo,
        );
        newConversation({
          template: currentConvo,
          preset: currentConvo,
          keepAddedConvos: true,
        });
        return true;
      }

      logger.info('conversation', 'Switching conversation to new endpoint/model', template);
      newConversation({
        template: {
          ...(template as Partial<TConversation>),
          chatProjectId: routeChatProjectId ?? conversation?.chatProjectId ?? null,
        },
        preset: { ...kwargs, spec: null, iconURL: null, modelLabel: null, endpoint: newEndpoint },
        keepAddedConvos: isNewModular,
      });
      return true;
    },
    [
      refuseIfSpecLocked,
      getConversation,
      getDefaultConversation,
      modularChat,
      newConversation,
      endpointsConfig,
      routeChatProjectId,
    ],
  );

  const onSelectPreset = useCallback(
    (_newPreset?: TPreset) => {
      if (!_newPreset) {
        return;
      }

      const conversation = getConversation();
      if (refuseIfSpecLocked(conversation)) {
        return;
      }

      const newPreset = removeUnavailableTools(_newPreset, availableTools);
      const newEndpoint = newPreset.endpoint ?? '';

      const {
        template,
        shouldSwitch,
        isNewModular,
        newEndpointType,
        isCurrentModular,
        isExistingConversation,
      } = getConvoSwitchLogic({
        newEndpoint,
        modularChat,
        conversation,
        endpointsConfig,
      });

      newPreset.spec = null;
      newPreset.iconURL = newPreset.iconURL ?? null;
      newPreset.modelLabel = newPreset.modelLabel ?? null;
      const isModular = isCurrentModular && isNewModular && shouldSwitch;
      const disableParams = newPreset.defaultPreset === true;
      if (isExistingConversation && isModular) {
        template.endpointType = newEndpointType as EModelEndpoint | undefined;
        template.spec = null;
        template.iconURL = null;
        template.modelLabel = null;
        const currentConvo = getDefaultConversation({
          /* target endpointType is necessary to avoid endpoint mixing */
          conversation: { ...(conversation ?? {}), endpointType: template.endpointType },
          preset: template,
          cleanInput: true,
        });

        /* We don't reset the latest message, only when changing settings mid-converstion */
        logger.info('conversation', 'Switching conversation to new preset (modular)', currentConvo);
        newConversation({
          template: currentConvo,
          preset: newPreset,
          keepAddedConvos: true,
          disableParams,
        });
        return;
      }

      logger.info('conversation', 'Switching conversation to new preset', template);
      newConversation({
        template: { chatProjectId: routeChatProjectId ?? conversation?.chatProjectId ?? null },
        preset: newPreset,
        keepAddedConvos: isModular,
        disableParams,
      });
    },
    [
      refuseIfSpecLocked,
      modularChat,
      getConversation,
      availableTools,
      newConversation,
      endpointsConfig,
      getDefaultConversation,
      routeChatProjectId,
    ],
  );

  const onSelectMention = useCallback(
    (option: MentionOption) => {
      const key = option.value;
      if (option.type === 'preset') {
        const preset = presets?.find((p) => p.presetId === key);
        onSelectPreset(preset);
      } else if (option.type === 'modelSpec') {
        const modelSpec = modelSpecs.find((spec) => spec.name === key);
        onSelectSpec(modelSpec);
      } else if (option.type === 'model') {
        onSelectEndpoint(key, { model: option.label });
      } else if (option.type === 'endpoint') {
        onSelectEndpoint(key);
      } else if (isAssistantsEndpoint(option.type)) {
        onSelectEndpoint(option.type, {
          assistant_id: key,
          model: assistantsMap?.[option.type]?.[key]?.model ?? '',
        });
      } else if (isAgentsEndpoint(option.type)) {
        onSelectEndpoint(option.type, {
          agent_id: key,
        });
      }
    },
    [modelSpecs, onSelectEndpoint, onSelectPreset, onSelectSpec, presets, assistantsMap],
  );

  if (returnHandlers) {
    return {
      onSelectSpec,
      onSelectEndpoint,
    };
  }

  return {
    onSelectMention,
  };
}
