import { useCallback } from 'react';
import { useSetRecoilState, useRecoilValue } from 'recoil';
import { isAssistantsEndpoint } from 'librechat-data-provider';

import type { TConversation } from 'librechat-data-provider';

import { isPrivateSpecName } from '~/hooks/Input/useSelectMention';
import { useGetStartupConfig } from '~/data-provider';
import { useGetConversation } from '~/hooks';
import { mainTextareaId } from '~/common';
import store from '~/store';

export type UseMultiConvoResult = {
  /** Assistants render their own comparison surface, so the action is hidden there.
   *  A confidential (private-spec) chat never compares against a second model. */
  show: boolean;
  addConversation: () => void;
};

/** Clones the current conversation into the second pane for side-by-side comparison. */
export default function useMultiConvo(): UseMultiConvoResult {
  const getConversation = useGetConversation(0);
  const endpoint = useRecoilValue(store.conversationEndpointByIndex(0));
  const spec = useRecoilValue(store.conversationSpecByIndex(0));
  const setAddedConvo = useSetRecoilState(store.conversationByIndex(1));
  const { data: startupConfig } = useGetStartupConfig();
  const privacyList = startupConfig?.modelSpecs?.list;
  const isPrivate = isPrivateSpecName(privacyList, spec);

  const addConversation = useCallback(() => {
    const conversation = getConversation();
    if (isPrivateSpecName(privacyList, conversation?.spec)) {
      return;
    }
    const { title: _title, ...convo } = conversation ?? ({} as TConversation);
    setAddedConvo({ ...convo, title: '' } as TConversation);
    document.getElementById(mainTextareaId)?.focus();
  }, [getConversation, setAddedConvo, privacyList]);

  return {
    show: endpoint != null && !isAssistantsEndpoint(endpoint) && !isPrivate,
    addConversation,
  };
}
