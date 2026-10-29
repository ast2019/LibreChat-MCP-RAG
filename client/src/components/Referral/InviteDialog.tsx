import * as Menu from '@ariakit/react/menu';
import { Gift } from 'lucide-react';
import {
  OGDialog,
  OGDialogTitle,
  OGDialogHeader,
  OGDialogContent,
  OGDialogDescription,
} from '@librechat/client';
import type { RefObject } from 'react';
import { useGetStartupConfig } from '~/data-provider';
import { useLocalize } from '~/hooks';
import InviteCard from './InviteCard';

/** «دعوت از دوستان» in the account menu, while invite rewards are on. */
export function InviteMenuItem({ onSelect }: { onSelect: () => void }) {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();
  if (startupConfig?.referral?.enabled !== true) {
    return null;
  }
  return (
    <Menu.MenuItem onClick={onSelect} className="select-item text-sm" data-testid="nav-invite">
      <Gift className="icon-md text-series-4" aria-hidden="true" />
      {localize('com_ui_referral_title')}
    </Menu.MenuItem>
  );
}

export function InviteDialog({
  open,
  onOpenChange,
  triggerRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef?: RefObject<HTMLButtonElement | HTMLDivElement | null>;
}) {
  const localize = useLocalize();
  return (
    <OGDialog open={open} onOpenChange={onOpenChange} triggerRef={triggerRef}>
      <OGDialogContent className="w-11/12 max-w-lg">
        <OGDialogHeader>
          <OGDialogTitle>{localize('com_ui_referral_title')}</OGDialogTitle>
          <OGDialogDescription>{localize('com_ui_referral_description')}</OGDialogDescription>
        </OGDialogHeader>
        {open && <InviteCard />}
      </OGDialogContent>
    </OGDialog>
  );
}
