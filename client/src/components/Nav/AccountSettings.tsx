import { useState, memo, useRef, useId } from 'react';
import { useSetAtom } from 'jotai';
import { useSetRecoilState } from 'recoil';
import * as Menu from '@ariakit/react/menu';
import { useNavigate } from 'react-router-dom';
import { SystemRoles } from 'librechat-data-provider';
import { GearIcon, DropdownMenuSeparator, Avatar } from '@librechat/client';
import {
  Archive,
  ChevronRight,
  CircleHelp,
  Files,
  Keyboard,
  LifeBuoy,
  LogOut,
  Scale,
  Shield,
  ShieldCheck,
  ShoppingBag,
  Wand2,
} from 'lucide-react';
import { ArchivedChatsModal } from '~/components/Nav/SettingsTabs/General/ArchivedChatsModal';
import { filesDialogTriggerAtom, showFilesDialogAtom } from '~/store/filesDialog';
import { InviteDialog, InviteMenuItem } from '~/components/Referral';
import { openInNewTab, policyUrls, getPackRemaining } from '~/utils';
import useDirection, { inlineSide } from '~/hooks/Nav/useDirection';
import { InstallDialog, InstallMenuItem } from '~/components/Pwa';
import { usePurchaseTarget } from '~/components/Balance/Purchase';
import useBalanceSummary from '~/hooks/useBalanceSummary';
import { MediaToolsDialog } from '~/components/Media';
import { useGetStartupConfig } from '~/data-provider';
import { useAuthContext } from '~/hooks/AuthContext';
import PackRing from '~/components/Balance/Ring';
import { settingsOpenAtom } from './Settings';
import Balance from '~/components/Balance';
import { useLocalize } from '~/hooks';
import store from '~/store';

function HelpSubmenu({
  helpAndFaqURL,
  termsOfServiceURL,
  privacyPolicyURL,
  onShowShortcuts,
}: {
  helpAndFaqURL?: string;
  termsOfServiceURL?: string;
  privacyPolicyURL?: string;
  onShowShortcuts: () => void;
}) {
  const localize = useLocalize();
  const hasHelpFaq = !!helpAndFaqURL && helpAndFaqURL !== '/';
  const hasTos = !!termsOfServiceURL;
  const hasPrivacy = !!privacyPolicyURL;
  const showLegalDivider = (hasHelpFaq || true) && (hasTos || hasPrivacy);
  const submenuSide = inlineSide(useDirection(), 'end');

  return (
    <Menu.MenuProvider placement={`${submenuSide}-start`}>
      <Menu.MenuItem
        hideOnClick={false}
        render={
          <Menu.MenuButton className="select-item flex w-full cursor-pointer items-center gap-2 text-sm" />
        }
      >
        <CircleHelp className="icon-md" aria-hidden="true" />
        <span className="flex-1 text-start">{localize('com_nav_help')}</span>
        <ChevronRight className="text-text-secondary h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
      </Menu.MenuItem>
      <Menu.Menu
        portal
        gutter={12}
        className="popover-ui popover-from-left z-[126] w-[min(15.25rem,90vw)]"
      >
        {hasHelpFaq && (
          <Menu.MenuItem
            onClick={() => openInNewTab(helpAndFaqURL)}
            className="select-item text-sm"
          >
            <LifeBuoy className="icon-md" aria-hidden="true" />
            {localize('com_nav_help_faq')}
          </Menu.MenuItem>
        )}
        <Menu.MenuItem onClick={onShowShortcuts} className="select-item text-sm">
          <Keyboard className="icon-md" aria-hidden="true" />
          {localize('com_shortcut_keyboard_shortcuts')}
        </Menu.MenuItem>
        {showLegalDivider && (hasTos || hasPrivacy) && <DropdownMenuSeparator />}
        {hasTos && (
          <Menu.MenuItem
            onClick={() => openInNewTab(termsOfServiceURL)}
            className="select-item text-sm"
          >
            <Scale className="icon-md" aria-hidden="true" />
            {localize('com_ui_terms_of_service')}
          </Menu.MenuItem>
        )}
        {hasPrivacy && (
          <Menu.MenuItem
            onClick={() => openInNewTab(privacyPolicyURL)}
            className="select-item text-sm"
          >
            <ShieldCheck className="icon-md" aria-hidden="true" />
            {localize('com_ui_privacy_policy')}
          </Menu.MenuItem>
        )}
      </Menu.Menu>
    </Menu.MenuProvider>
  );
}

function AccountSettings({ collapsed = false }: { collapsed?: boolean }) {
  const localize = useLocalize();
  const { user, logout } = useAuthContext();
  const navigate = useNavigate();
  const { data: startupConfig } = useGetStartupConfig();
  const { privacyPolicyUrl, termsOfServiceUrl } = policyUrls(startupConfig);
  const setShowSettings = useSetAtom(settingsOpenAtom);
  const setShowFiles = useSetAtom(showFilesDialogAtom);
  const setFilesDialogTrigger = useSetAtom(filesDialogTriggerAtom);
  const setShowShortcutsDialog = useSetRecoilState(store.showShortcutsDialog);
  const [showArchived, setShowArchived] = useState(false);
  const [showInstall, setShowInstall] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showMediaTools, setShowMediaTools] = useState(false);
  const purchase = usePurchaseTarget();
  const { state: balanceState, balance } = useBalanceSummary();
  const pack = getPackRemaining(
    balance,
    balanceState.status === 'success' ? balanceState.summary : null,
  );
  const packDescriptionId = useId();
  const accountSettingsButtonRef = useRef<HTMLButtonElement>(null);
  /** The collapsed rail opens the menu beside it, toward the content. */
  const railSide = inlineSide(useDirection(), 'end');

  return (
    <Menu.MenuProvider placement={collapsed ? `${railSide}-end` : undefined}>
      <Menu.MenuButton
        ref={accountSettingsButtonRef}
        aria-label={localize('com_nav_account_settings')}
        aria-describedby={pack != null ? packDescriptionId : undefined}
        data-testid="nav-user"
        className={
          collapsed
            ? 'hover:bg-surface-nav-hover aria-[expanded=true]:bg-surface-nav-selected flex h-9 w-9 items-center justify-center rounded-lg transition-colors'
            : 'hover:bg-surface-nav-hover aria-[expanded=true]:bg-surface-nav-selected flex h-auto w-full items-center gap-2 rounded-xl p-2 text-sm transition-all duration-200 ease-in-out'
        }
      >
        {pack != null ? (
          /** The ring takes the avatar's place at the same outer size, so the button and the
           *  rail do not move when a pack is granted or runs out. */
          <PackRing percent={pack.percent} tone={pack.tone}>
            <Avatar user={user} size={collapsed ? 24 : 26} />
          </PackRing>
        ) : (
          <div className={collapsed ? 'size-7 shrink-0' : 'h-8 w-8 shrink-0'}>
            <div className="relative flex">
              <Avatar user={user} size={collapsed ? 28 : 32} />
            </div>
          </div>
        )}
        {pack != null && (
          <span id={packDescriptionId} className="sr-only">
            {localize('com_ui_balance_pack_remaining', { 0: String(pack.percent) })}
          </span>
        )}
        {!collapsed && (
          <div className="text-text-primary grow overflow-hidden text-start text-ellipsis whitespace-nowrap">
            {user?.name ?? user?.username ?? localize('com_nav_user')}
          </div>
        )}
      </Menu.MenuButton>
      <Menu.Menu
        portal
        className="popover-ui z-[125] w-[min(19.0625rem,90vw)] md:w-[min(15.25rem,90vw)]"
        style={{
          transformOrigin: collapsed
            ? `${railSide === 'right' ? 'left' : 'right'} bottom`
            : 'bottom',
          translate: collapsed ? `${railSide === 'right' ? 4 : -4}px 0` : '0 -4px',
        }}
      >
        <div className="text-text-secondary ms-3 me-2 py-2 text-sm" role="note">
          {user?.email ?? localize('com_nav_user')}
        </div>
        {/* Renders nothing when the deployment does not meter credits */}
        <Balance className="ms-3 me-2 pb-2" />
        <DropdownMenuSeparator />
        <HelpSubmenu
          helpAndFaqURL={startupConfig?.helpAndFaqURL}
          termsOfServiceURL={termsOfServiceUrl}
          privacyPolicyURL={privacyPolicyUrl}
          onShowShortcuts={() => setShowShortcutsDialog(true)}
        />
        <Menu.MenuItem onClick={() => setShowArchived(true)} className="select-item text-sm">
          <Archive className="icon-md" aria-hidden="true" />
          {localize('com_nav_archived_chats')}
        </Menu.MenuItem>

        <Menu.MenuItem
          onClick={() => {
            /** The menu is gone by the time the dialog captures focus, so the
             *  account button has to be named here or focus returns to the
             *  document body when the dialog closes. */
            setFilesDialogTrigger(accountSettingsButtonRef);
            setShowFiles(true);
          }}
          className="select-item text-sm"
          data-testid="nav-files"
        >
          <Files className="icon-md" aria-hidden="true" />
          {localize('com_nav_my_files')}
        </Menu.MenuItem>
        {user?.role === SystemRoles.ADMIN && (
          <Menu.MenuItem
            onClick={() => navigate('/admin')}
            className="select-item text-sm"
            data-testid="nav-admin"
          >
            <Shield className="icon-md" aria-hidden="true" />
            {localize('com_admin_title')}
          </Menu.MenuItem>
        )}
        <Menu.MenuItem
          onClick={() => setShowSettings(true)}
          className="select-item text-sm"
          data-testid="nav-settings"
        >
          <GearIcon className="icon-md" aria-hidden="true" />
          {localize('com_nav_settings')}
        </Menu.MenuItem>
        {purchase?.kind === 'internal' && (
          <Menu.MenuItem
            onClick={() => navigate(purchase.to)}
            className="select-item text-sm"
            data-testid="nav-buy-pack"
          >
            <ShoppingBag className="icon-md" aria-hidden="true" />
            {localize('com_ui_balance_buy_pack')}
          </Menu.MenuItem>
        )}
        <Menu.MenuItem
          onClick={() => setShowMediaTools(true)}
          className="select-item text-sm"
          data-testid="nav-media-tools"
        >
          <Wand2 className="icon-md" aria-hidden="true" />
          {localize('com_media_tools_title')}
        </Menu.MenuItem>
        <InviteMenuItem onSelect={() => setShowInvite(true)} />
        <InstallMenuItem onSelect={() => setShowInstall(true)} />
        <DropdownMenuSeparator />
        <Menu.MenuItem onClick={() => logout()} className="select-item text-sm">
          <LogOut className="icon-md" aria-hidden="true" />
          {localize('com_nav_log_out')}
        </Menu.MenuItem>
      </Menu.Menu>
      {showMediaTools && (
        <MediaToolsDialog
          open={showMediaTools}
          onOpenChange={setShowMediaTools}
          triggerRef={accountSettingsButtonRef}
        />
      )}
      {showInvite && (
        <InviteDialog
          open={showInvite}
          onOpenChange={setShowInvite}
          triggerRef={accountSettingsButtonRef}
        />
      )}
      {showInstall && (
        <InstallDialog
          open={showInstall}
          onOpenChange={setShowInstall}
          triggerRef={accountSettingsButtonRef}
        />
      )}
      {showArchived && (
        <ArchivedChatsModal
          open={showArchived}
          onOpenChange={setShowArchived}
          triggerRef={accountSettingsButtonRef}
        />
      )}
    </Menu.MenuProvider>
  );
}

export default memo(AccountSettings);
