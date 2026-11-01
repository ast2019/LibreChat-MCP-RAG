import { OFFICE_ARTIFACT_KEY } from 'librechat-data-provider';
import type { OfficeFile } from './tools';

export interface OfficeAttachment extends OfficeFile {
  messageId?: string;
  toolCallId?: string;
}

const isOfficeFile = (value: unknown): value is OfficeFile => {
  const file = value as Partial<OfficeFile> | null;
  return (
    file != null &&
    typeof file.file_id === 'string' &&
    typeof file.filename === 'string' &&
    typeof file.filepath === 'string'
  );
};

/**
 * The files an Office tool saved, as attachments of the message the run is writing, so the chat
 * draws their cards and «خروجی‌های این گفتگو» lists them.
 */
export function getOfficeAttachments(
  artifact: Record<string, unknown> | null | undefined,
  owner: { messageId?: string; toolCallId?: string; conversationId?: string },
): OfficeAttachment[] {
  const files = artifact?.[OFFICE_ARTIFACT_KEY];
  if (!Array.isArray(files)) {
    return [];
  }
  return files.filter(isOfficeFile).map((file) => ({
    ...file,
    messageId: owner.messageId,
    toolCallId: owner.toolCallId,
    conversationId: owner.conversationId ?? file.conversationId,
  }));
}
