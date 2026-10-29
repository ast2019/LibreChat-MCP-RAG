import { useMemo } from 'react';
import type { TModelSpec } from 'librechat-data-provider';
import { useGetStartupConfig } from '~/data-provider';
import { useChatContext } from '~/Providers';
import { getModelSpec } from '~/utils';

/**
 * How private a conversation's model is, as the user chose it in the model selector, in
 * rising order of how distinct the chat should look:
 * - `confidential`: a `privacy: 'private'` spec, sent only to providers that keep nothing;
 * - `local`: a `privacy: 'local'` spec, run on the deployment's own server;
 * - `admin`: an `adminOnly` spec. Those are also local, so `adminOnly` is read first.
 */
export type ChatMode = 'confidential' | 'local' | 'admin';

export function getChatMode(spec?: Pick<TModelSpec, 'privacy' | 'adminOnly'> | null): ChatMode | null {
  if (!spec) {
    return null;
  }
  if (spec.adminOnly === true) {
    return 'admin';
  }
  if (spec.privacy === 'local') {
    return 'local';
  }
  if (spec.privacy === 'private') {
    return 'confidential';
  }
  return null;
}

/** The mode of the conversation in this chat pane, or null for an ordinary chat. */
export default function useChatMode(): ChatMode | null {
  const { conversation } = useChatContext();
  const { data: startupConfig } = useGetStartupConfig();
  return useMemo(
    () => getChatMode(getModelSpec({ specName: conversation?.spec, startupConfig })),
    [conversation?.spec, startupConfig],
  );
}
