import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { OGDialog, OGDialogTemplate, Spinner, useToastContext } from '@librechat/client';
import type { TFile } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import type { FileOutput } from './collect';
import FilePreviewDialog from '~/components/Chat/Messages/Content/FilePreviewDialog';
import { useGetMessagesByConvoId } from '~/data-provider';
import { findMessageRow, focusMessageRow } from './jump';
import { useAuthContext } from '~/hooks/AuthContext';
import { useFileMapContext } from '~/Providers';
import { collectChatOutputs } from './collect';
import { FileRow, VideoRow } from './Row';
import { useLocalize } from '~/hooks';

type OutputsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="text-text-secondary mb-2 text-xs font-medium">
        {title}
      </h3>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}

/** The stored record wins over a message's copy: it carries the owner, source and current path. */
const withStored = (output: FileOutput, fileMap?: Record<string, TFile>): FileOutput => {
  const stored = output.file.file_id ? fileMap?.[output.file.file_id] : undefined;
  return stored ? { ...output, file: { ...output.file, ...stored } } : output;
};

function OutputsList({
  conversationId,
  onJump,
}: {
  conversationId: string;
  onJump: (messageId: string) => void;
}) {
  const localize = useLocalize();
  const { user } = useAuthContext();
  const fileMap = useFileMapContext();
  /** The chat view already loaded these; this only reads the cache and follows its updates. */
  const { data: messages, isError } = useGetMessagesByConvoId(conversationId, { enabled: false });
  const { generated, uploaded } = useMemo(() => {
    const outputs = collectChatOutputs(messages);
    return {
      generated: outputs.generated.map((output) =>
        output.kind === 'file' ? withStored(output, fileMap) : output,
      ),
      uploaded: outputs.uploaded.map((output) => withStored(output, fileMap)),
    };
  }, [messages, fileMap]);
  const [previewing, setPreviewing] = useState<FileOutput | null>(null);
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null);

  const openPreview = useCallback((output: FileOutput, trigger: HTMLButtonElement) => {
    previewTriggerRef.current = trigger;
    setPreviewing(output);
  }, []);

  if (messages == null) {
    if (isError) {
      return (
        <p role="alert" className="text-text-secondary py-6 text-center text-sm">
          {localize('com_ui_outputs_error')}
        </p>
      );
    }
    return (
      <div role="status" className="flex justify-center py-6">
        <Spinner />
        <span className="sr-only">{localize('com_ui_loading')}</span>
      </div>
    );
  }

  if (generated.length === 0 && uploaded.length === 0) {
    return (
      <p className="text-text-secondary py-6 text-center text-sm">
        {localize('com_ui_outputs_empty')}
      </p>
    );
  }

  const fileRow = (output: FileOutput) => (
    <FileRow
      key={output.key}
      output={output}
      userId={user?.id}
      onPreview={openPreview}
      onJump={onJump}
    />
  );

  return (
    <div className="max-h-[60vh] space-y-4 overflow-y-auto">
      {generated.length > 0 && (
        <Section title={localize('com_ui_outputs_generated')}>
          {generated.map((output) =>
            output.kind === 'video' ? (
              <VideoRow key={output.key} output={output} onJump={onJump} />
            ) : (
              fileRow(output)
            ),
          )}
        </Section>
      )}
      {uploaded.length > 0 && (
        <Section title={localize('com_ui_outputs_uploaded')}>{uploaded.map(fileRow)}</Section>
      )}
      {previewing != null && (
        <FilePreviewDialog
          open
          onOpenChange={(next) => {
            if (!next) {
              setPreviewing(null);
            }
          }}
          fileName={previewing.file.filename}
          fileId={previewing.file.file_id}
          filePath={previewing.file.filepath}
          fileType={previewing.file.type}
          fileSource={previewing.file.source}
          fileSize={previewing.file.bytes}
          deliveryPath={previewing.file.llmDeliveryPath}
          triggerRef={previewTriggerRef}
        />
      )}
    </div>
  );
}

/**
 * «خروجی‌های گفتگو»: what this chat made and what the user attached to it, with open, download
 * and a way back to the message. Deleting stays in My Files, so nothing here removes a file.
 */
export default function OutputsDialog({
  open,
  onOpenChange,
  conversationId,
  triggerRef,
}: OutputsDialogProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  /** The message to focus after closing, in place of the menu that opened the dialog. */
  const jumpTargetRef = useRef<HTMLElement | null>(null);

  const jump = useCallback(
    (messageId: string) => {
      void findMessageRow(messageId).then((row) => {
        if (row == null) {
          showToast({ status: 'info', message: localize('com_ui_outputs_not_in_view') });
          return;
        }
        jumpTargetRef.current = row;
        /** The owner's setter directly: OGDialog's own close would send focus to the trigger. */
        onOpenChange(false);
      });
    },
    [localize, onOpenChange, showToast],
  );

  return (
    <OGDialog open={open} onOpenChange={onOpenChange} triggerRef={triggerRef}>
      <OGDialogTemplate
        title={localize('com_ui_outputs')}
        description={localize('com_ui_outputs_description')}
        showCloseButton
        showCancelButton={false}
        className="w-11/12 max-w-lg"
        main={<OutputsList conversationId={conversationId} onJump={jump} />}
        onCloseAutoFocus={(event) => {
          const target = jumpTargetRef.current;
          if (target == null) {
            return;
          }
          jumpTargetRef.current = null;
          event.preventDefault();
          focusMessageRow(target);
        }}
      />
    </OGDialog>
  );
}
