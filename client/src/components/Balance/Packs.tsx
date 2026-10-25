import { ExternalLink } from 'lucide-react';
import { Button, Spinner, OGDialog, OGDialogClose, OGDialogTemplate } from '@librechat/client';
import type { TUserBalancePack } from 'librechat-data-provider';
import type { ReactNode, RefObject } from 'react';
import useBalancePacks from '~/hooks/useBalancePacks';
import useLocalize from '~/hooks/useLocalize';
import { formatRialDigits } from '~/utils';

interface PacksProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef?: RefObject<HTMLElement | null>;
}

function PackCard({ pack }: { pack: TUserBalancePack }) {
  const localize = useLocalize();
  return (
    <li
      className="border-border-light bg-surface-secondary flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl border p-4"
      data-testid="balance-pack"
    >
      <div className="min-w-0 flex-1">
        <h3 className="text-text-primary text-sm font-medium">{pack.label}</h3>
        {pack.description != null && pack.description !== '' && (
          <p className="text-text-secondary mt-1 text-xs">{pack.description}</p>
        )}
      </div>
      <span className="text-text-primary text-sm font-semibold whitespace-nowrap">
        {pack.priceRial != null
          ? localize('com_ui_balance_rial', { 0: formatRialDigits(pack.priceRial) })
          : localize('com_ui_balance_price_unavailable')}
      </span>
    </li>
  );
}

/** The packs a user can buy, priced in rial. Buying happens at `purchaseUrl` or via support. */
export default function Packs({ open, onOpenChange, triggerRef }: PacksProps) {
  const localize = useLocalize();
  const { query } = useBalancePacks();
  const { data, isLoading, isError, refetch } = query;
  const packs = data?.enabled === true ? data.packs : [];
  const purchaseUrl = data?.purchaseUrl;

  let main: ReactNode;
  if (isLoading) {
    main = (
      <div
        className="flex justify-center py-6"
        role="status"
        aria-label={localize('com_ui_loading')}
      >
        <Spinner className="size-5" />
      </div>
    );
  } else if (isError && data == null) {
    main = (
      <div className="space-y-3 py-2">
        <p role="alert" className="text-text-destructive text-sm">
          {localize('com_ui_balance_packs_error')}
        </p>
        <Button size="compact" variant="outline" onClick={() => refetch()}>
          {localize('com_ui_retry')}
        </Button>
      </div>
    );
  } else if (packs.length === 0) {
    main = (
      <p className="text-text-secondary py-2 text-sm">{localize('com_ui_balance_packs_empty')}</p>
    );
  } else {
    main = (
      <div className="space-y-3">
        <ul className="space-y-2" aria-label={localize('com_ui_balance_buy_pack')}>
          {packs.map((pack) => (
            <PackCard key={pack.id} pack={pack} />
          ))}
        </ul>
        {(purchaseUrl == null || purchaseUrl === '') && (
          <p className="text-text-secondary text-xs">{localize('com_ui_balance_packs_contact')}</p>
        )}
      </div>
    );
  }

  return (
    <OGDialog open={open} onOpenChange={onOpenChange} triggerRef={triggerRef}>
      <OGDialogTemplate
        title={localize('com_ui_balance_buy_pack')}
        className="w-11/12 md:max-w-lg"
        showCloseButton={false}
        showCancelButton={false}
        main={main}
        buttons={
          <>
            <OGDialogClose asChild>
              <Button variant="outline">{localize('com_ui_close')}</Button>
            </OGDialogClose>
            {packs.length > 0 && purchaseUrl != null && purchaseUrl !== '' && (
              <Button asChild>
                <a href={purchaseUrl} target="_blank" rel="noopener noreferrer">
                  {localize('com_ui_balance_go_to_purchase')}
                  <ExternalLink className="ms-1 size-4 rtl:-scale-x-100" aria-hidden="true" />
                </a>
              </Button>
            )}
          </>
        }
      />
    </OGDialog>
  );
}
