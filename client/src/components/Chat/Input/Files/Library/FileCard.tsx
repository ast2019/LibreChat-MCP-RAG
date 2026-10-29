import { memo, useState } from 'react';
import { Download, Eye, Trash2 } from 'lucide-react';
import { apiBaseUrl } from 'librechat-data-provider';
import { Checkbox, IconButton, Spinner } from '@librechat/client';
import type { TFile } from 'librechat-data-provider';
import { getDisplayType } from '~/components/Chat/Messages/Content/FilePreviewDialog';
import { isImage, previewOf } from '~/components/Chat/Input/Composer/Files';
import FilePreview from '~/components/Chat/Input/Files/FilePreview';
import { getFileType, toAbsoluteFilePath, cn } from '~/utils';
import { formatFileBytes, formatFileDate } from './format';
import { useLocalize } from '~/hooks';

/** The image itself for images; a large file-type tile otherwise or when the image fails. */
function Cover({ file }: { file: TFile }) {
  const [failed, setFailed] = useState(false);
  if (isImage(file) && !failed && file.filepath) {
    return (
      <img
        src={toAbsoluteFilePath(file.filepath, apiBaseUrl())}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
      />
    );
  }
  return (
    <span className="flex h-full w-full items-center justify-center">
      <FilePreview file={file} fileType={getFileType(file.type)} className="size-12 rounded-xl" />
    </span>
  );
}

interface FileCardProps {
  file: TFile;
  lang: string;
  selected: boolean;
  downloading: boolean;
  onToggle: (file: TFile) => void;
  onPreview: (file: TFile, trigger: HTMLButtonElement) => void;
  onDownload: (file: TFile) => void;
  onDelete: (file: TFile, trigger: HTMLButtonElement) => void;
}

/** One file in the library: a cover to preview it, its name and details, and its actions. */
const FileCard = memo(function FileCard({
  file,
  lang,
  selected,
  downloading,
  onToggle,
  onPreview,
  onDownload,
  onDelete,
}: FileCardProps) {
  const localize = useLocalize();
  const name = file.filename ?? '';
  const canPreview = previewOf(file) != null;
  const details = [
    getDisplayType(localize, file.type ?? undefined, name),
    formatFileBytes(file.bytes ?? 0, lang),
  ];
  const date = formatFileDate(file, lang);

  return (
    <div
      className={cn(
        'group border-border-light bg-surface-primary hover:border-border-medium relative flex flex-col overflow-hidden rounded-2xl border transition-colors hover:shadow-xs',
        selected && 'border-border-heavy bg-surface-secondary ring-ring-primary ring-1',
      )}
      data-testid="file-card"
    >
      <div className="bg-surface-tertiary relative h-32 w-full overflow-hidden">
        {canPreview ? (
          <button
            type="button"
            onClick={(event) => onPreview(file, event.currentTarget)}
            className="focus-visible:ring-ring-primary block h-full w-full cursor-zoom-in focus:outline-hidden focus-visible:ring-2 focus-visible:ring-inset"
            aria-label={localize('com_ui_composer_preview_file', { 0: name })}
          >
            <Cover file={file} />
          </button>
        ) : (
          <Cover file={file} />
        )}
        <span className="bg-surface-primary absolute inset-s-2 top-2 flex rounded-md p-1 shadow-xs">
          <Checkbox
            checked={selected}
            onCheckedChange={() => onToggle(file)}
            aria-label={localize('com_files_select_file', { 0: name })}
            className="flex"
          />
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
        <span className="text-text-primary truncate text-sm font-semibold" title={name} dir="auto">
          {name}
        </span>
        <span className="text-text-secondary truncate text-xs">{details.join(' · ')}</span>
        <div className="mt-1 flex items-center gap-1">
          <span className="text-text-tertiary flex-1 truncate text-xs">{date}</span>
          {canPreview && (
            <IconButton
              size="sm"
              shape="square"
              variant="ghost"
              label={localize('com_ui_composer_preview_file', { 0: name })}
              onClick={(event) => onPreview(file, event.currentTarget)}
            >
              <Eye className="text-text-secondary size-4" aria-hidden="true" />
            </IconButton>
          )}
          <IconButton
            size="sm"
            shape="square"
            variant="ghost"
            label={localize('com_files_download_file', { 0: name })}
            onClick={() => onDownload(file)}
            disabled={downloading}
            aria-busy={downloading}
          >
            {downloading ? (
              <Spinner className="size-4" />
            ) : (
              <Download className="text-text-secondary size-4" aria-hidden="true" />
            )}
          </IconButton>
          <IconButton
            size="sm"
            shape="square"
            variant="ghost"
            label={localize('com_files_delete_file', { 0: name })}
            onClick={(event) => onDelete(file, event.currentTarget)}
          >
            <Trash2 className="text-text-destructive size-4" aria-hidden="true" />
          </IconButton>
        </div>
      </div>
    </div>
  );
});

/** Card-shaped placeholders while the library loads. */
export function FileCardSkeletons({ count = 8 }: { count?: number }) {
  return (
    <ul
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      aria-hidden="true"
    >
      {Array.from({ length: count }, (_, index) => (
        <li key={index} className="border-border-light overflow-hidden rounded-2xl border">
          <div className="bg-surface-tertiary h-32 w-full animate-pulse motion-reduce:animate-none" />
          <div className="space-y-2 p-3">
            <div className="bg-surface-tertiary h-4 w-3/4 animate-pulse rounded-lg motion-reduce:animate-none" />
            <div className="bg-surface-tertiary h-3 w-1/2 animate-pulse rounded-lg motion-reduce:animate-none" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default FileCard;
