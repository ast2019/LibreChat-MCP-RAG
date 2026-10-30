import { memo } from 'react';
import { Clapperboard, Download, Eye, MessageSquare } from 'lucide-react';
import { Button, FileIcon, Spinner, TooltipAnchor } from '@librechat/client';
import type { ReactNode } from 'react';
import type { FileOutput, VideoOutput } from './collect';
import { formatBytes, getDisplayType } from '~/components/Chat/Messages/Content/FilePreviewDialog';
import { displayFilename } from '~/components/Chat/Messages/Content/Parts/attachmentTypes';
import { useAttachmentLink } from '~/components/Chat/Messages/Content/Parts/LogLink';
import { getFileType, triggerDownload, usesImagePreview } from '~/utils';
import { useMediaJobQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';

function Action({
  label,
  icon,
  onClick,
  disabled = false,
}: {
  label: string;
  icon: ReactNode;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
}) {
  return (
    <TooltipAnchor
      description={label}
      side="top"
      render={
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {icon}
        </Button>
      }
    />
  );
}

function Shell({
  thumb,
  name,
  detail,
  actions,
}: {
  thumb: ReactNode;
  name: string;
  detail: ReactNode;
  actions: ReactNode;
}) {
  return (
    <li className="border-border-light flex items-center gap-3 rounded-lg border px-3 py-2">
      <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md">
        {thumb}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-text-primary block truncate text-sm font-medium" title={name}>
          {name}
        </span>
        <span className="text-text-secondary block truncate text-xs">{detail}</span>
      </span>
      <span className="flex shrink-0 items-center gap-0.5">{actions}</span>
    </li>
  );
}

const iconClass = 'size-4';

export type FileRowProps = {
  output: FileOutput;
  /** The signed-in user, for message copies of a file that omit their owner. */
  userId?: string;
  /** Opens the preview, which returns focus to `trigger` when it closes. */
  onPreview: (output: FileOutput, trigger: HTMLButtonElement) => void;
  onJump: (messageId: string) => void;
};

export const FileRow = memo(function FileRow({ output, userId, onPreview, onJump }: FileRowProps) {
  const localize = useLocalize();
  const { file } = output;
  const name = displayFilename(file.filename);
  const { handleDownload } = useAttachmentLink({
    href: file.filepath,
    filename: file.filename,
    file_id: file.file_id,
    user: file.user ?? userId,
    source: file.source,
  });

  const type = getDisplayType(localize, file.type, file.filename);
  const detail = file.bytes ? `${type} · ${formatBytes(file.bytes)}` : type;
  const thumb = usesImagePreview(file) ? (
    <img src={file.filepath} alt="" className="size-10 object-cover" loading="lazy" />
  ) : (
    <FileIcon file={file} fileType={getFileType(file.type)} />
  );

  return (
    <Shell
      thumb={thumb}
      name={name}
      detail={detail}
      actions={
        <>
          <Action
            label={localize('com_ui_open_var', { 0: name })}
            icon={<Eye className={iconClass} aria-hidden="true" />}
            disabled={!file.file_id}
            onClick={(event) => onPreview(output, event.currentTarget)}
          />
          <Action
            label={localize('com_ui_outputs_download', { 0: name })}
            icon={<Download className={iconClass} aria-hidden="true" />}
            onClick={(event) => void handleDownload(event)}
          />
          <Action
            label={localize('com_ui_outputs_jump', { 0: name })}
            icon={<MessageSquare className={iconClass} aria-hidden="true" />}
            onClick={() => onJump(output.messageId)}
          />
        </>
      }
    />
  );
});

const videoFilename = (type?: string): string => `video.${type?.split('/')[1] || 'mp4'}`;

export const VideoRow = memo(function VideoRow({
  output,
  onJump,
}: {
  output: VideoOutput;
  onJump: (messageId: string) => void;
}) {
  const localize = useLocalize();
  const { data, isError } = useMediaJobQuery(output.jobId);
  const filepath = data?.status === 'completed' ? data.filepath : undefined;
  const name = data?.label || localize('com_ui_outputs_video');

  let detail: ReactNode = (
    <span className="inline-flex items-center gap-1">
      <Spinner className="shrink-0" size={12} />
      {localize('com_media_job_pending')}
    </span>
  );
  if (filepath) {
    detail = localize('com_ui_outputs_video_ready');
  } else if (isError || data?.status === 'failed') {
    detail = localize('com_media_job_error');
  }

  return (
    <Shell
      thumb={<Clapperboard className="text-text-secondary size-5" aria-hidden="true" />}
      name={name}
      detail={detail}
      actions={
        <>
          <Action
            label={localize('com_ui_open_var', { 0: name })}
            icon={<Eye className={iconClass} aria-hidden="true" />}
            disabled={!filepath}
            onClick={() => {
              if (filepath) {
                window.open(filepath, '_blank', 'noopener,noreferrer');
              }
            }}
          />
          <Action
            label={localize('com_ui_outputs_download', { 0: name })}
            icon={<Download className={iconClass} aria-hidden="true" />}
            disabled={!filepath}
            onClick={() => {
              if (filepath) {
                triggerDownload(filepath, videoFilename(data?.type));
              }
            }}
          />
          <Action
            label={localize('com_ui_outputs_jump', { 0: name })}
            icon={<MessageSquare className={iconClass} aria-hidden="true" />}
            onClick={() => onJump(output.messageId)}
          />
        </>
      }
    />
  );
});
