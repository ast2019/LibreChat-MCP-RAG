import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSetAtom } from 'jotai';
import { useRecoilValue } from 'recoil';
import { FolderOpen, Search } from 'lucide-react';
import { filesFamily } from '@librechat/chat/react';
import { dataService } from 'librechat-data-provider';
import {
  Input,
  Label,
  Radio,
  Button,
  Spinner,
  Checkbox,
  OGDialog,
  Dropdown,
  TrashIcon,
  OGDialogTitle,
  OGDialogContent,
  OGDialogTemplate,
  OGDialogDescription,
  useToastContext,
} from '@librechat/client';
import type { TFile } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { isImage, isDocument, FilePreviewer } from '~/components/Chat/Input/Composer/Files';
import { useGetFiles, isDirectDownloadSource } from '~/data-provider';
import { getDownloadFilename, triggerDownload } from '~/utils';
import { formatCount, formatFileBytes, fileTime } from './Library/format';
import FileCard, { FileCardSkeletons } from './Library/FileCard';
import { useDeleteFilesFromTable } from '~/hooks/Files';
import { useLocalize, useAuthContext } from '~/hooks';
import store from '~/store';

type View = 'all' | 'images' | 'documents';
type Sort = 'newest' | 'oldest' | 'name' | 'largest';

const PAGE_SIZE = 48;
const NO_FILES: TFile[] = [];

const VIEWS: Array<{ value: View; labelKey: TranslationKeys }> = [
  { value: 'all', labelKey: 'com_ui_all_proper' },
  { value: 'images', labelKey: 'com_ui_composer_files_images' },
  { value: 'documents', labelKey: 'com_ui_composer_files_documents' },
];

const SORTS: Array<{ value: Sort; labelKey: TranslationKeys }> = [
  { value: 'newest', labelKey: 'com_files_sort_newest' },
  { value: 'oldest', labelKey: 'com_files_sort_oldest' },
  { value: 'name', labelKey: 'com_files_sort_name' },
  { value: 'largest', labelKey: 'com_files_sort_largest' },
];

function matchesView(file: TFile, view: View): boolean {
  if (view === 'images') {
    return isImage(file);
  }
  if (view === 'documents') {
    return isDocument(file);
  }
  return true;
}

function compare(sort: Sort): (a: TFile, b: TFile) => number {
  switch (sort) {
    case 'oldest':
      return (a, b) => fileTime(a) - fileTime(b);
    case 'name':
      return (a, b) => (a.filename ?? '').localeCompare(b.filename ?? '');
    case 'largest':
      return (a, b) => (b.bytes ?? 0) - (a.bytes ?? 0);
    default:
      return (a, b) => fileTime(b) - fileTime(a);
  }
}

/** The user's file library: search, filter by kind, sort, preview, download and delete. */
export function MyFilesModal({
  open,
  onOpenChange,
  triggerRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
}) {
  const localize = useLocalize();
  const lang = useRecoilValue(store.lang);
  const viewLabelId = useId();
  const selectAllId = useId();
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const { user } = useAuthContext();
  const { showToast } = useToastContext();

  const captureReturnFocus = useCallback(() => {
    const activeElement = document.activeElement;
    const canRestoreShortcutFocus =
      activeElement instanceof HTMLElement &&
      activeElement !== document.body &&
      activeElement.isConnected &&
      activeElement.closest('[inert]') == null &&
      activeElement.closest('[role="menu"]') == null;
    returnFocusRef.current = canRestoreShortcutFocus
      ? activeElement
      : (triggerRef?.current ?? null);
  }, [triggerRef]);

  const library = useGetFiles<TFile[]>();
  const allFiles = library.data ?? NO_FILES;

  const [search, setSearch] = useState('');
  const [view, setView] = useState<View>('all');
  const [sort, setSort] = useState<Sort>('newest');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [previewing, setPreviewing] = useState<TFile | null>(null);
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  /** Files waiting for the user to confirm their deletion. */
  const [pendingDelete, setPendingDelete] = useState<TFile[] | null>(null);
  /** Hidden from the grid while their deletion is in flight; the server answer clears them, so a
   *  file the server failed to delete shows again. */
  const [deletingIds, setDeletingIds] = useState<Set<string>>(() => new Set());
  const isDeleting = deletingIds.size > 0;

  const setComposerFiles = useSetAtom(filesFamily(0));
  const { deleteFiles } = useDeleteFilesFromTable(() => setDeletingIds(new Set()));

  const files = useMemo(
    () =>
      deletingIds.size === 0 ? allFiles : allFiles.filter((file) => !deletingIds.has(file.file_id)),
    [allFiles, deletingIds],
  );
  const query = search.trim().toLowerCase();
  const counts = useMemo(
    () => ({
      all: files.length,
      images: files.filter(isImage).length,
      documents: files.filter(isDocument).length,
    }),
    [files],
  );
  const totalBytes = useMemo(
    () => files.reduce((sum, file) => sum + (Number(file.bytes) || 0), 0),
    [files],
  );
  const visible = useMemo(
    () =>
      files
        .filter(
          (file) =>
            matchesView(file, view) &&
            (query === '' || file.filename?.toLowerCase().includes(query) === true),
        )
        .sort(compare(sort)),
    [files, view, query, sort],
  );
  const shown = visible.slice(0, limit);

  /* A new search, kind or order starts from the first page again. */
  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [query, view, sort]);

  /* Drop selections for files that no longer exist (deleted elsewhere or refetched). */
  useEffect(() => {
    setSelected((current) => {
      if (current.size === 0) {
        return current;
      }
      const ids = new Set(files.map((file) => file.file_id));
      const next = new Set([...current].filter((id) => ids.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [files]);

  const toggle = useCallback((file: TFile) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(file.file_id)) {
        next.delete(file.file_id);
      } else {
        next.add(file.file_id);
      }
      return next;
    });
  }, []);

  const allVisibleSelected = visible.length > 0 && visible.every((f) => selected.has(f.file_id));
  const toggleAllVisible = () => {
    setSelected((current) => {
      const next = new Set(current);
      for (const file of visible) {
        if (allVisibleSelected) {
          next.delete(file.file_id);
        } else {
          next.add(file.file_id);
        }
      }
      return next;
    });
  };

  const openPreview = useCallback((file: TFile, trigger: HTMLButtonElement) => {
    previewTriggerRef.current = trigger;
    setPreviewing(file);
  }, []);

  const download = useCallback(
    async (file: TFile) => {
      if (!user?.id) {
        return;
      }
      setDownloadingId(file.file_id);
      const filename = getDownloadFilename(file.filename, file.file_id, file.source);
      try {
        if (isDirectDownloadSource(file.source)) {
          try {
            const direct = await dataService.getFileDownloadURL(user.id, file.file_id);
            if (direct.url) {
              triggerDownload(direct.url, filename);
              return;
            }
          } catch {
            // Fall back to the proxied download below.
          }
        }
        const response = await dataService.getFileDownload(user.id, file.file_id);
        triggerDownload(window.URL.createObjectURL(response.data), filename);
      } catch (error) {
        console.error('Error downloading file:', error);
        showToast({ status: 'error', message: localize('com_ui_download_error') });
      } finally {
        setDownloadingId(null);
      }
    },
    [user?.id, showToast, localize],
  );

  const deleteTriggerRef = useRef<HTMLElement | null>(null);
  const askDelete = useCallback((file: TFile, trigger: HTMLButtonElement) => {
    deleteTriggerRef.current = trigger;
    setPendingDelete([file]);
  }, []);
  const askDeleteSelected = (event: React.MouseEvent<HTMLButtonElement>) => {
    deleteTriggerRef.current = event.currentTarget;
    setPendingDelete(files.filter((file) => selected.has(file.file_id)));
  };
  const confirmDelete = () => {
    if (pendingDelete == null || pendingDelete.length === 0) {
      return;
    }
    setDeletingIds((current) => {
      const next = new Set(current);
      for (const file of pendingDelete) {
        next.add(file.file_id);
      }
      return next;
    });
    deleteFiles({ files: pendingDelete, setFiles: setComposerFiles });
    setSelected((current) => {
      const next = new Set(current);
      for (const file of pendingDelete) {
        next.delete(file.file_id);
      }
      return next;
    });
    showToast({
      status: 'success',
      message: localize('com_files_deleted', { 0: formatCount(pendingDelete.length, lang) }),
    });
    setPendingDelete(null);
  };

  const viewOptions = VIEWS.map((option) => ({
    value: option.value,
    label: `${localize(option.labelKey)} (${formatCount(counts[option.value], lang)})`,
  }));
  const sortOptions = SORTS.map((option) => ({
    value: option.value,
    label: localize(option.labelKey),
  }));

  const isLoading = library.isLoading;
  const loadFailed = library.isError && files.length === 0;
  const isEmptyLibrary = !isLoading && !loadFailed && files.length === 0;

  let body: React.ReactNode;
  if (isLoading) {
    body = (
      <div role="status" aria-busy="true">
        <span className="sr-only">{localize('com_ui_loading')}</span>
        <FileCardSkeletons />
      </div>
    );
  } else if (loadFailed) {
    body = (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <p role="alert" className="text-text-destructive text-sm">
          {localize('com_files_load_error')}
        </p>
        {/* The files query does not refetch on mount, focus or reconnect. */}
        <Button type="button" variant="outline" size="sm" onClick={() => void library.refetch()}>
          {localize('com_ui_retry')}
        </Button>
      </div>
    );
  } else if (isEmptyLibrary) {
    body = (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <span className="bg-surface-tertiary flex size-14 items-center justify-center rounded-2xl">
          <FolderOpen className="text-text-secondary size-7" aria-hidden="true" />
        </span>
        <p className="text-text-primary text-base font-semibold">
          {localize('com_files_empty_title')}
        </p>
        <p className="text-text-secondary max-w-sm text-sm">
          {localize('com_files_empty_description')}
        </p>
      </div>
    );
  } else if (visible.length === 0) {
    body = (
      <div
        role="status"
        className="flex flex-col items-center justify-center gap-3 py-16 text-center"
      >
        <Search className="text-text-tertiary size-8" aria-hidden="true" />
        <p className="text-text-secondary text-sm">{localize('com_files_no_results')}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setSearch('');
            setView('all');
          }}
        >
          {localize('com_files_clear_filters')}
        </Button>
      </div>
    );
  } else {
    body = (
      <>
        <p className="sr-only" role="status" aria-live="polite">
          {localize('com_ui_search_results_count', { count: visible.length })}
        </p>
        <ul
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          aria-label={localize('com_nav_my_files')}
        >
          {shown.map((file) => (
            <li key={file.file_id}>
              <FileCard
                file={file}
                lang={lang}
                selected={selected.has(file.file_id)}
                downloading={downloadingId === file.file_id}
                onToggle={toggle}
                onPreview={openPreview}
                onDownload={download}
                onDelete={askDelete}
              />
            </li>
          ))}
        </ul>
        {visible.length > shown.length && (
          <div className="flex justify-center pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setLimit((current) => current + PAGE_SIZE)}
            >
              {localize('com_files_show_more', {
                0: formatCount(visible.length - shown.length, lang),
              })}
            </Button>
          </div>
        )}
      </>
    );
  }

  const selectedCount = selected.size;

  return (
    <OGDialog open={open} onOpenChange={onOpenChange} triggerRef={returnFocusRef}>
      <OGDialogContent
        title={localize('com_nav_my_files')}
        onOpenAutoFocus={captureReturnFocus}
        className="flex h-[85vh] max-h-[860px] w-11/12 max-w-6xl flex-col overflow-hidden"
      >
        <div className="flex h-full min-h-0 min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <OGDialogTitle>{localize('com_nav_my_files')}</OGDialogTitle>
            <OGDialogDescription>
              {files.length > 0
                ? localize('com_files_summary', {
                    0: formatCount(files.length, lang),
                    1: formatFileBytes(totalBytes, lang),
                  })
                : localize('com_files_description')}
            </OGDialogDescription>
          </div>

          <div className="-ms-1 -me-5 min-h-0 flex-1 overflow-y-auto ps-1 pe-5">
            {!isEmptyLibrary && !loadFailed && (
              <div className="bg-surface-dialog sticky top-0 z-10 flex flex-col gap-2 pt-1 pb-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1 basis-56">
                    <Input
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder={localize('com_files_filter')}
                      aria-label={localize('com_files_filter')}
                    />
                  </div>
                  <Label id={viewLabelId} className="sr-only">
                    {localize('com_files_filter_by')}
                  </Label>
                  <Radio
                    wrap
                    options={viewOptions}
                    value={view}
                    onChange={(value) => setView(value as View)}
                    aria-labelledby={viewLabelId}
                  />
                  <Dropdown
                    value={sort}
                    onChange={(value) => setSort(value as Sort)}
                    options={sortOptions}
                    ariaLabel={localize('com_files_sort')}
                    testId="files-sort"
                  />
                </div>

                {files.length > 0 && (
                  <div
                    className="border-border-light min-h-theme-target flex flex-wrap items-center gap-2 rounded-xl border px-3 py-1.5"
                    aria-live="polite"
                  >
                    <span className="flex items-center gap-2 text-sm">
                      <Checkbox
                        id={selectAllId}
                        aria-labelledby={`${selectAllId}-label`}
                        checked={allVisibleSelected}
                        onCheckedChange={toggleAllVisible}
                        disabled={visible.length === 0}
                        className="flex"
                      />
                      <Label
                        id={`${selectAllId}-label`}
                        htmlFor={selectAllId}
                        variant="secondary"
                        className="cursor-pointer"
                      >
                        {localize('com_ui_select_all')}
                      </Label>
                    </span>
                    <span className="text-text-secondary flex-1 text-sm">
                      {selectedCount > 0 &&
                        localize('com_files_selected_count', {
                          0: formatCount(selectedCount, lang),
                        })}
                    </span>
                    {selectedCount > 0 && (
                      <>
                        <Button
                          type="button"
                          size="compact"
                          variant="ghost"
                          onClick={() => setSelected(new Set())}
                        >
                          {localize('com_files_clear_selection')}
                        </Button>
                        <Button
                          type="button"
                          size="compact"
                          variant="destructive-soft"
                          onClick={askDeleteSelected}
                          disabled={isDeleting}
                          aria-busy={isDeleting}
                        >
                          {isDeleting ? (
                            <Spinner className="size-3.5" />
                          ) : (
                            <TrashIcon className="size-3.5" aria-hidden="true" />
                          )}
                          <span className="ms-1">{localize('com_files_delete_selected')}</span>
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
            {body}
          </div>
        </div>

        <FilePreviewer
          file={previewing}
          triggerRef={previewTriggerRef}
          onClose={() => setPreviewing(null)}
        />

        <OGDialog
          open={pendingDelete != null}
          onOpenChange={(next) => !next && setPendingDelete(null)}
          triggerRef={deleteTriggerRef}
        >
          <OGDialogTemplate
            title={localize('com_files_delete_title', {
              0: formatCount(pendingDelete?.length ?? 0, lang),
            })}
            className="w-11/12 md:max-w-md"
            showCloseButton={false}
            main={
              <p className="text-text-secondary text-sm">
                {pendingDelete?.length === 1
                  ? localize('com_files_delete_one_body', { 0: pendingDelete[0].filename ?? '' })
                  : localize('com_files_delete_many_body')}
              </p>
            }
            buttons={
              <Button variant="destructive" onClick={confirmDelete}>
                {localize('com_ui_delete')}
              </Button>
            }
          />
        </OGDialog>
      </OGDialogContent>
    </OGDialog>
  );
}
