import type { AgentListResponse } from 'librechat-data-provider';

/**
 * Agents shown in the chat model / endpoint picker.
 *
 * Returns every row from a VIEW-scoped list, including Viewer-shared agents
 * (`isEditable: false`). EDIT-only filtering belongs in Agent Builder, not here:
 * marketplace access must not hide use-only shares from people who can chat with them.
 */
export function agentsForChatUse(data: AgentListResponse): AgentListResponse['data'] {
  return data.data;
}
