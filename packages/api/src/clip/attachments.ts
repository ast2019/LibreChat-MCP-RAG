import { CLIP_ARTIFACT_KEY } from 'librechat-data-provider';
import type { ClipFile } from './tools';

export interface ClipAttachment extends ClipFile {
  messageId?: string;
  toolCallId?: string;
}

const isClipFile = (value: unknown): value is ClipFile => {
  const file = value as Partial<ClipFile> | null;
  return (
    file != null &&
    typeof file.file_id === 'string' &&
    typeof file.filename === 'string' &&
    typeof file.filepath === 'string'
  );
};

/**
 * The files a clip tool saved, as attachments of the message the run is writing, so the chat
 * draws their cards and «خروجی‌های این گفتگو» lists them.
 */
export function getClipAttachments(
  artifact: Record<string, unknown> | null | undefined,
  owner: { messageId?: string; toolCallId?: string; conversationId?: string },
): ClipAttachment[] {
  const files = artifact?.[CLIP_ARTIFACT_KEY];
  if (!Array.isArray(files)) {
    return [];
  }
  return files.filter(isClipFile).map((file) => ({
    ...file,
    messageId: owner.messageId,
    toolCallId: owner.toolCallId,
    conversationId: owner.conversationId ?? file.conversationId,
  }));
}
