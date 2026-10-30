import { Tools } from 'librechat-data-provider';
import type { TFile, TMessage, TAttachment } from 'librechat-data-provider';
import { isInternalSandboxArtifact } from '~/components/Chat/Messages/Content/Parts/attachmentTypes';
import { collectToolMediaJobIds } from '~/utils/mediaJobs';

/** The fields of a file this panel reads; message copies of a file carry only some of them. */
export type OutputFile = Partial<TFile> & { filename: string; filepath: string };

export type FileOutput = { kind: 'file'; key: string; messageId: string; file: OutputFile };
export type VideoOutput = { kind: 'video'; key: string; messageId: string; jobId: string };
export type ChatOutput = FileOutput | VideoOutput;

export type ChatOutputs = {
  /** What tools made in this chat: images, code files and videos. */
  generated: ChatOutput[];
  /** Files the user attached to their own messages. */
  uploaded: FileOutput[];
};

/** Attachments that report a search, memory or interface payload rather than a file. */
const NON_FILE_ATTACHMENTS = new Set<string>([
  Tools.memory,
  Tools.web_search,
  Tools.file_search,
  Tools.ui_resources,
]);

const asOutputFile = (file: Partial<TFile> | undefined): OutputFile | null => {
  if (file == null || !file.filename || !file.filepath) {
    return null;
  }
  return file as OutputFile;
};

const attachmentFile = (attachment: TAttachment | undefined): OutputFile | null => {
  if (attachment == null || (attachment.type && NON_FILE_ATTACHMENTS.has(attachment.type))) {
    return null;
  }
  if (attachment[Tools.memory] != null || isInternalSandboxArtifact(attachment)) {
    return null;
  }
  return asOutputFile(attachment as Partial<TFile>);
};

const fileKey = (file: OutputFile): string => file.file_id || file.filepath;

/**
 * Everything this chat produced or received, newest first, in one pass over the loaded messages
 * (every branch, so a regenerated answer's outputs stay reachable). A file that several messages
 * carry is listed once, under its newest message.
 */
export function collectChatOutputs(messages: readonly TMessage[] | null | undefined): ChatOutputs {
  const generated: ChatOutput[] = [];
  const uploaded: FileOutput[] = [];
  if (!messages?.length) {
    return { generated, uploaded };
  }
  const seenGenerated = new Set<string>();
  const seenUploaded = new Set<string>();
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    const { messageId } = message;
    if (message.isCreatedByUser) {
      for (const candidate of message.files ?? []) {
        const file = asOutputFile(candidate);
        const key = file ? fileKey(file) : '';
        if (file && !seenUploaded.has(key)) {
          seenUploaded.add(key);
          uploaded.push({ kind: 'file', key: `upload:${key}`, messageId, file });
        }
      }
      continue;
    }
    for (const jobId of collectToolMediaJobIds(message.content)) {
      if (!seenGenerated.has(jobId)) {
        seenGenerated.add(jobId);
        generated.push({ kind: 'video', key: `video:${jobId}`, messageId, jobId });
      }
    }
    for (const attachment of message.attachments ?? []) {
      const file = attachmentFile(attachment);
      const key = file ? fileKey(file) : '';
      if (file && !seenGenerated.has(key)) {
        seenGenerated.add(key);
        generated.push({ kind: 'file', key: `output:${key}`, messageId, file });
      }
    }
  }
  return { generated, uploaded };
}
