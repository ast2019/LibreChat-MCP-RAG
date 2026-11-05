import type { Agent, AgentListResponse } from 'librechat-data-provider';
import { agentsForChatUse } from '../agentList';

const agent = (id: string, isEditable?: boolean): Agent =>
  ({
    id,
    name: id,
    provider: 'openAI',
    model: 'gpt-4o',
    ...(isEditable !== undefined ? { isEditable } : {}),
  }) as Agent;

const list = (data: Agent[]): AgentListResponse => ({
  object: 'list',
  data,
  first_id: data[0]?.id ?? '',
  last_id: data[data.length - 1]?.id ?? '',
  has_more: false,
});

describe('agentsForChatUse', () => {
  it('keeps Viewer-shared agents (isEditable: false) in the chat picker list', () => {
    const rows = agentsForChatUse(
      list([agent('owned', true), agent('shared-viewer', false), agent('legacy-unset')]),
    );

    expect(rows?.map((row) => row.id)).toEqual(['owned', 'shared-viewer', 'legacy-unset']);
  });

  it('does not drop a public Viewer share when marketplace users also have editable agents', () => {
    const rows = agentsForChatUse(list([agent('editor-share', true), agent('viewer-share', false)]));

    expect(rows?.some((row) => row.id === 'viewer-share' && row.isEditable === false)).toBe(true);
  });
});
