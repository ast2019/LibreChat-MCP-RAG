import { useState } from 'react';
import { useAtom } from 'jotai';
import * as Menu from '@ariakit/react/menu';
import { MonitorDown, Share, SquarePlus } from 'lucide-react';
import {
  Button,
  OGDialog,
  OGDialogTitle,
  OGDialogFooter,
  OGDialogHeader,
  OGDialogContent,
  OGDialogDescription,
} from '@librechat/client';
import type { RefObject } from 'react';
import type { InstallMode } from './install';
import { INSTALL_DISMISSED_KEY, promptInstall, useInstallMode } from './install';
import { createStorageAtom } from '~/store/jotai-utils';
import { useLocalize } from '~/hooks';

export const installDismissedAtom = createStorageAtom<boolean>(INSTALL_DISMISSED_KEY, false);

/** The install entry is offered while the app can be installed and the user has not
 *  chosen "Don't show again". */
export function useInstallOffer(): InstallMode {
  const mode = useInstallMode();
  const [dismissed] = useAtom(installDismissedAtom);
  return dismissed ? null : mode;
}

export function InstallMenuItem({ onSelect }: { onSelect: () => void }) {
  const localize = useLocalize();
  const mode = useInstallOffer();
  if (!mode) {
    return null;
  }
  return (
    <Menu.MenuItem onClick={onSelect} className="select-item text-sm" data-testid="nav-install">
      <MonitorDown className="icon-md" aria-hidden="true" />
      {localize('com_pwa_install')}
    </Menu.MenuItem>
  );
}

export function InstallDialog({
  open,
  onOpenChange,
  triggerRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef?: RefObject<HTMLButtonElement | HTMLDivElement | null>;
}) {
  const localize = useLocalize();
  const mode = useInstallMode();
  const [, setDismissed] = useAtom(installDismissedAtom);
  const [pending, setPending] = useState(false);

  const install = async () => {
    setPending(true);
    try {
      /** `prompt()` must run inside this click; `promptInstall` calls it before awaiting. */
      await promptInstall();
    } finally {
      setPending(false);
      onOpenChange(false);
    }
  };

  const dismiss = () => {
    setDismissed(true);
    onOpenChange(false);
  };

  return (
    <OGDialog open={open} onOpenChange={onOpenChange} triggerRef={triggerRef}>
      <OGDialogContent className="w-11/12 max-w-md">
        <OGDialogHeader>
          <OGDialogTitle>{localize('com_pwa_install_title')}</OGDialogTitle>
          <OGDialogDescription>{localize('com_pwa_install_description')}</OGDialogDescription>
        </OGDialogHeader>
        {mode === 'ios' && (
          <ol className="text-text-primary flex list-none flex-col gap-3 p-0 text-sm">
            <li className="flex items-center gap-3">
              <Share className="icon-md text-text-secondary shrink-0" aria-hidden="true" />
              <span>{localize('com_pwa_ios_step_share')}</span>
            </li>
            <li className="flex items-center gap-3">
              <SquarePlus className="icon-md text-text-secondary shrink-0" aria-hidden="true" />
              <span>{localize('com_pwa_ios_step_add')}</span>
            </li>
          </ol>
        )}
        <OGDialogFooter className="gap-2">
          <Button variant="outline" onClick={dismiss} data-testid="pwa-install-dismiss">
            {localize('com_pwa_install_never')}
          </Button>
          {mode === 'native' ? (
            <Button onClick={install} disabled={pending} data-testid="pwa-install-confirm">
              {localize('com_pwa_install_action')}
            </Button>
          ) : (
            <Button onClick={() => onOpenChange(false)}>{localize('com_ui_close')}</Button>
          )}
        </OGDialogFooter>
      </OGDialogContent>
    </OGDialog>
  );
}
