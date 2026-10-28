import type { ReactNode } from 'react';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';
import useLocalize from '~/hooks/useLocalize';
import { useDocumentTitle } from '~/hooks';
import Checkout from './Checkout';
import Result from './Result';

function Page({ children }: { children: ReactNode }) {
  const localize = useLocalize();
  useDocumentTitle(localize('com_ui_payment_title'));
  return (
    <main className="bg-surface-primary h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-xl space-y-4 px-4 py-6">
        <OpenSidebar />
        {children}
      </div>
    </main>
  );
}

/** `/payment`: pick a pack and a gateway. */
export function CheckoutView() {
  return (
    <Page>
      <Checkout />
    </Page>
  );
}

/** `/payment/result`: where the gateway sends the buyer back. */
export function ResultView() {
  return (
    <Page>
      <Result />
    </Page>
  );
}
