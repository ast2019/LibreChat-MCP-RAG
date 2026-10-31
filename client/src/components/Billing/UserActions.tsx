import { useId, useState } from 'react';
import * as Ariakit from '@ariakit/react';
import { SystemRoles } from 'librechat-data-provider';
import { DropdownPopup, Button } from '@librechat/client';
import {
  ChartPie,
  Ellipsis,
  ShieldCheck,
  ShieldOff,
  SlidersHorizontal,
  WalletCards,
} from 'lucide-react';
import type { TAdminBillingUser } from 'librechat-data-provider';
import type * as t from '~/common';
import { useLocalize } from '~/hooks';

export type UserAction = 'details' | 'usage' | 'grant' | 'role';

/** One row's actions behind a single «⋯» button, so the table stays narrow. */
export default function UserActions({
  user,
  isSelf,
  onAction,
}: {
  user: TAdminBillingUser;
  /** The signed-in admin's own row: their role cannot be changed from here. */
  isSelf: boolean;
  onAction: (action: UserAction, user: TAdminBillingUser) => void;
}) {
  const localize = useLocalize();
  const menuId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const isAdmin = user.role === SystemRoles.ADMIN;
  const who = user.name || user.username || user.email || user.phone || '';

  const items: t.MenuItemProps[] = [
    {
      id: `details-${user.id}`,
      label: localize('com_admin_user_details'),
      icon: <SlidersHorizontal className="text-text-secondary size-4" aria-hidden="true" />,
      onClick: () => onAction('details', user),
    },
    {
      id: `usage-${user.id}`,
      label: localize('com_admin_spend_button'),
      icon: <ChartPie className="text-text-secondary size-4" aria-hidden="true" />,
      onClick: () => onAction('usage', user),
    },
    {
      id: `grant-${user.id}`,
      label: localize('com_admin_grant'),
      icon: <WalletCards className="text-text-secondary size-4" aria-hidden="true" />,
      onClick: () => onAction('grant', user),
    },
    { separate: true },
    {
      id: `role-${user.id}`,
      label: isSelf
        ? localize('com_admin_role_self')
        : localize(isAdmin ? 'com_admin_role_demote' : 'com_admin_role_promote'),
      disabled: isSelf,
      icon: isAdmin ? (
        <ShieldOff className="text-text-secondary size-4" aria-hidden="true" />
      ) : (
        <ShieldCheck className="text-text-secondary size-4" aria-hidden="true" />
      ),
      onClick: () => onAction('role', user),
    },
  ];

  const label = localize('com_admin_user_actions', { 0: who });

  return (
    <DropdownPopup
      menuId={menuId}
      unmountOnHide={true}
      isOpen={isOpen}
      setIsOpen={setIsOpen}
      items={items}
      trigger={
        <Ariakit.MenuButton
          aria-label={label}
          title={label}
          aria-expanded={isOpen}
          data-testid="admin-user-actions"
          render={<Button size="icon" variant="ghost" className="size-8 shrink-0" />}
        >
          <Ellipsis className="size-4" aria-hidden="true" />
        </Ariakit.MenuButton>
      }
    />
  );
}
