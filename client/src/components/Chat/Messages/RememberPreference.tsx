import { useMemo, useState } from 'react';
import { Button } from '@librechat/client';
import type { TUserMemory } from 'librechat-data-provider';
import MemoryCreateDialog from '~/components/SidePanel/Memories/MemoryCreateDialog';
import MemoryEditDialog from '~/components/SidePanel/Memories/MemoryEditDialog';
import useHasMemoryAccess from '~/hooks/Roles/useHasMemoryAccess';
import { useAuthContext } from '~/hooks/AuthContext';
import { useMemoriesQuery } from '~/data-provider';
import useLocalize from '~/hooks/useLocalize';

/** The memory key a preference from feedback goes under; one of the deployment's valid keys. */
export const PREFERENCE_MEMORY_KEY = 'preferences';

/** Whether this user may turn feedback into a memory: memory is on for the role and the user. */
export function useCanRememberPreference(): boolean {
  const { user } = useAuthContext();
  return useHasMemoryAccess() && user?.personalization?.memories !== false;
}

/** «این را به‌عنوان ترجیح من به خاطر بسپار», under the feedback text. */
export function RememberPreferenceButton({
  text,
  onRemember,
}: {
  text: string | undefined;
  onRemember: (text: string) => void;
}) {
  const localize = useLocalize();
  const allowed = useCanRememberPreference();
  if (!allowed) {
    return null;
  }
  const trimmed = text?.trim() ?? '';
  return (
    <div className="min-w-0 space-y-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={trimmed === ''}
        onClick={() => onRemember(trimmed)}
        data-testid="feedback-remember"
      >
        {localize('com_ui_feedback_remember')}
      </Button>
      <p className="text-text-secondary text-xs">{localize('com_ui_feedback_remember_hint')}</p>
    </div>
  );
}

/**
 * Opens the ordinary memory dialog with the feedback filled in, so nothing is saved until the user
 * reads it and presses save. A preference already on file is extended rather than duplicated:
 * the memory store allows one entry per key.
 */
export function RememberPreferenceDialog({ text, onClose }: { text: string; onClose: () => void }) {
  const { data, isLoading } = useMemoriesQuery();
  /**
   * The preference on file when the list first arrives, kept from then on: the edit dialog resets
   * its fields whenever `memory` changes, so a background refetch must not hand it a new object.
   */
  const [existing, setExisting] = useState<TUserMemory | null | undefined>(undefined);
  if (!isLoading && existing === undefined) {
    setExisting(
      data?.memories.find(
        (memory) => memory.key === PREFERENCE_MEMORY_KEY && memory.agentId == null,
      ) ?? null,
    );
  }
  const extended = useMemo<TUserMemory | null>(
    () =>
      existing == null ? null : { ...existing, value: `${existing.value.trimEnd()}\n${text}` },
    [existing, text],
  );
  if (existing === undefined) {
    return null;
  }
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose();
    }
  };
  if (extended != null) {
    return (
      <MemoryEditDialog memory={extended} open onOpenChange={handleOpenChange}>
        {null}
      </MemoryEditDialog>
    );
  }
  return (
    <MemoryCreateDialog
      open
      onOpenChange={handleOpenChange}
      initialKey={PREFERENCE_MEMORY_KEY}
      initialValue={text}
    >
      {null}
    </MemoryCreateDialog>
  );
}
