import { useCallback } from 'react';
import { useSetAtom } from 'jotai';
import { useRecoilValue } from 'recoil';
import { Button } from '@librechat/client';
import { activePanelAtom } from '~/Providers/ActivePanelContext';
import useSidebarToggle from '~/hooks/Nav/useSidebarToggle';
import useLocalize from '~/hooks/useLocalize';
import store from '~/store';

/** The side panel that lists, edits and deletes memories (see `useSideNavLinks`). */
const MEMORIES_PANEL = 'memories';

/**
 * «مشاهده در حافظه»: opens the memory panel, the one place memories are edited or deleted, so the
 * chat card stays a notice and never a second editor.
 */
export default function MemoryLink() {
  const localize = useLocalize();
  const setActivePanel = useSetAtom(activePanelAtom);
  const sidebarExpanded = useRecoilValue(store.sidebarExpanded);
  const { setSidebarOpen } = useSidebarToggle();

  const open = useCallback(() => {
    setActivePanel(MEMORIES_PANEL);
    if (!sidebarExpanded) {
      setSidebarOpen(true);
    }
  }, [setActivePanel, sidebarExpanded, setSidebarOpen]);

  return (
    <Button type="button" variant="text-action" onClick={open} data-testid="memory-view-link">
      {localize('com_ui_memory_view')}
    </Button>
  );
}
