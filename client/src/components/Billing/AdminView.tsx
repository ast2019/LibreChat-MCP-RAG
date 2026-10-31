import * as Tabs from '@radix-ui/react-tabs';
import { SystemRoles } from 'librechat-data-provider';
import { Navigate, useSearchParams } from 'react-router-dom';
import type { TranslationKeys } from '~/hooks/useLocalize';
import { useAuthContext, useDocumentTitle, useLocalize } from '~/hooks';
import { StatusAlert, StatusPanel } from '~/components/Admin/Status';
import AdminPayments from '~/components/Payments/AdminPayments';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';
import Overview from './Overview';
import Advanced from './Advanced';
import Access from './Access';
import Users from './Users';
import Gifts from './Gifts';
import Packs from './Packs';

const TABS: { id: string; label: TranslationKeys }[] = [
  { id: 'overview', label: 'com_admin_tab_overview' },
  { id: 'users', label: 'com_admin_tab_users' },
  { id: 'packs', label: 'com_admin_tab_packs' },
  { id: 'access', label: 'com_admin_tab_access' },
  { id: 'payments', label: 'com_admin_payments_title' },
  { id: 'gifts', label: 'com_admin_tab_gifts' },
  { id: 'status', label: 'com_admin_tab_status' },
  { id: 'advanced', label: 'com_admin_tab_advanced' },
];

/**
 * The one place admin tools live: sales, users and credit, what users may use, payments, the health and
 * credit of external services, and the admin's advanced mode. The chat itself looks the same for admins and users.
 */
export default function AdminView() {
  const localize = useLocalize();
  const { user } = useAuthContext();
  const [params, setParams] = useSearchParams();
  const isAdmin = user?.role === SystemRoles.ADMIN;
  const requested = params.get('tab');
  const tab = TABS.some((item) => item.id === requested) ? (requested as string) : 'overview';

  useDocumentTitle(localize('com_admin_title'));

  if (user != null && !isAdmin) {
    return <Navigate to="/c/new" replace={true} />;
  }

  return (
    <main className="bg-surface-primary h-full overflow-y-auto" aria-labelledby="admin-title">
      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6">
        <header className="flex flex-wrap items-center gap-3">
          <OpenSidebar />
          <h1 id="admin-title" className="text-text-primary flex-1 text-2xl font-semibold">
            {localize('com_admin_title')}
          </h1>
        </header>

        {isAdmin && (
          <Tabs.Root
            value={tab}
            onValueChange={(value) => setParams({ tab: value }, { replace: true })}
            className="space-y-6"
          >
            <Tabs.List
              aria-label={localize('com_admin_title')}
              className="border-border-light flex gap-1 overflow-x-auto border-b"
            >
              {TABS.map((item) => (
                <Tabs.Trigger
                  key={item.id}
                  value={item.id}
                  className="text-text-secondary data-[state=active]:border-text-primary data-[state=active]:text-text-primary hover:text-text-primary -mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium whitespace-nowrap focus-visible:outline-none"
                >
                  {localize(item.label)}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            <Tabs.Content value="overview" className="space-y-6 focus-visible:outline-none">
              <StatusAlert onOpen={() => setParams({ tab: 'status' }, { replace: true })} />
              <Overview />
            </Tabs.Content>
            <Tabs.Content value="users" className="focus-visible:outline-none">
              <Users />
            </Tabs.Content>
            <Tabs.Content value="packs" className="focus-visible:outline-none">
              <Packs />
            </Tabs.Content>
            <Tabs.Content value="access" className="focus-visible:outline-none">
              <Access />
            </Tabs.Content>
            <Tabs.Content value="gifts" className="focus-visible:outline-none">
              <Gifts />
            </Tabs.Content>
            <Tabs.Content value="payments" className="focus-visible:outline-none">
              <AdminPayments />
            </Tabs.Content>
            <Tabs.Content value="status" className="focus-visible:outline-none">
              <StatusPanel />
            </Tabs.Content>
            <Tabs.Content value="advanced" className="focus-visible:outline-none">
              <Advanced />
            </Tabs.Content>
          </Tabs.Root>
        )}
      </div>
    </main>
  );
}
