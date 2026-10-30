import { ContentTypes, Tools } from 'librechat-data-provider';
import type { TAttachment, TMessage, TMessageContentParts } from 'librechat-data-provider';
import { collectChatOutputs } from '../collect';

const JOB = '6720f1c2a9b3c4d5e6f70812';

const message = (overrides: Partial<TMessage>): TMessage =>
  ({
    messageId: 'm',
    conversationId: 'c',
    parentMessageId: null,
    text: '',
    isCreatedByUser: false,
    ...overrides,
  }) as TMessage;

const attachment = (overrides: Record<string, unknown>) =>
  ({ messageId: 'm', toolCallId: 't', ...overrides }) as unknown as TAttachment;

const videoCall = (output: string) =>
  ({
    type: ContentTypes.TOOL_CALL,
    [ContentTypes.TOOL_CALL]: { id: 'call', name: 'generate_video', args: '{}', output },
  }) as unknown as TMessageContentParts;

describe('collectChatOutputs', () => {
  it('returns empty lists for a chat with no messages', () => {
    expect(collectChatOutputs(undefined)).toEqual({ generated: [], uploaded: [] });
    expect(collectChatOutputs([])).toEqual({ generated: [], uploaded: [] });
  });

  it('splits tool outputs from the user attachments, newest message first', () => {
    const messages = [
      message({
        messageId: 'u1',
        isCreatedByUser: true,
        files: [{ file_id: 'up1', filename: 'brief.pdf', filepath: '/uploads/brief.pdf' }],
      }),
      message({
        messageId: 'a1',
        attachments: [
          attachment({ file_id: 'img1', filename: 'cat.png', filepath: '/images/cat.png' }),
        ],
      }),
      message({
        messageId: 'a2',
        content: [videoCall(`Job: /api/media/jobs/${JOB}`)],
        attachments: [
          attachment({ file_id: 'csv1', filename: 'data.csv', filepath: '/api/files/code/x' }),
        ],
      }),
    ];
    const { generated, uploaded } = collectChatOutputs(messages);
    expect(generated.map((output) => [output.kind, output.messageId])).toEqual([
      ['video', 'a2'],
      ['file', 'a2'],
      ['file', 'a1'],
    ]);
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]).toMatchObject({ messageId: 'u1', file: { file_id: 'up1' } });
  });

  it('skips memory, search and sandbox placeholder attachments', () => {
    const messages = [
      message({
        attachments: [
          attachment({ type: Tools.memory, [Tools.memory]: { key: 'k', value: 'v' } }),
          attachment({ type: Tools.web_search, filename: 'r', filepath: '/x' }),
          attachment({
            filename: '_.dirkeep-a1b2c3',
            filepath: '/code/_.dirkeep-a1b2c3',
            bytes: 0,
          }),
          attachment({ filename: 'no-path.txt' }),
        ],
      }),
    ];
    expect(collectChatOutputs(messages).generated).toEqual([]);
  });

  it('lists a file carried by several messages once, under the newest', () => {
    const file = { file_id: 'f1', filename: 'plot.png', filepath: '/images/plot.png' };
    const messages = [
      message({ messageId: 'old', attachments: [attachment(file)] }),
      message({ messageId: 'new', attachments: [attachment(file)] }),
    ];
    const { generated } = collectChatOutputs(messages);
    expect(generated).toHaveLength(1);
    expect(generated[0].messageId).toBe('new');
  });

  it('does not treat a link the model wrote in a user turn as a generated video', () => {
    const messages = [
      message({ isCreatedByUser: true, content: [videoCall(`/api/media/jobs/${JOB}`)] }),
    ];
    expect(collectChatOutputs(messages).generated).toEqual([]);
  });
});
