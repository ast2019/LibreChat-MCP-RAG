import { useMemo } from 'react';
import { useGetCustomConfigSpeechQuery } from 'librechat-data-provider/react-query';
import type { SpeechConversation, SpeechRouteFields } from '~/utils/speech';
import { isLocalSpeechConversation, toSpeechRouteFields } from '~/utils/speech';
import { useGetStartupConfig } from '~/data-provider';

export interface SpeechRoute {
  /** Sent with server speech requests so the server can route them like the conversation. */
  fields: SpeechRouteFields;
  /** The conversation runs on the deployment's own model: browser speech only. */
  local: boolean;
}

/** How speech for a conversation is routed; `local` keeps audio and text on the device. */
export default function useSpeechRoute(conversation?: SpeechConversation | null): SpeechRoute {
  const { data: speechConfig } = useGetCustomConfigSpeechQuery({ enabled: true });
  const { data: startupConfig } = useGetStartupConfig();
  const serverSpeech = speechConfig?.serverSpeech;
  const specs = startupConfig?.modelSpecs?.list;
  const conversationId = conversation?.conversationId;
  const endpoint = conversation?.endpoint;
  const spec = conversation?.spec;

  return useMemo(() => {
    const current = { conversationId, endpoint, spec };
    return {
      fields: toSpeechRouteFields(current),
      local: isLocalSpeechConversation(current, serverSpeech, specs),
    };
  }, [conversationId, endpoint, spec, serverSpeech, specs]);
}
