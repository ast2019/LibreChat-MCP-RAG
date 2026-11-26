import { PurchaseLink, usePurchaseTarget } from './Purchase';
import useBalanceSummary from '~/hooks/useBalanceSummary';
import { useGetTimePackStatus } from '~/data-provider';
import useLocalize from '~/hooks/useLocalize';
import TimePackStatus from './TimePackStatus';
import Summary from './Summary';

/**
 * The user's balance, or nothing when the deployment does not meter credits. Pack prices live
 * on the packs page alone; here, while there is a reason to buy (the free trial, or credit run
 * out), a single link leads there.
 */
export default function Balance({ className }: { className?: string }) {
  const localize = useLocalize();
  const { enabled, state, currency } = useBalanceSummary();
  const purchase = usePurchaseTarget();
  const timePackActive = state.status === 'success' && state.summary.timePackExpiresAt != null;
  const { data: timePackStatus } = useGetTimePackStatus({ enabled: enabled && timePackActive });
  if (!enabled) {
    return null;
  }
  const offerPurchase = purchase != null && state.status === 'success' && state.summary.showPrices;
  return (
    <div className={className}>
      <Summary state={state} currency={currency} />
      {timePackActive && <TimePackStatus status={timePackStatus} className="mt-3" />}
      {offerPurchase && (
        <PurchaseLink
          target={purchase}
          className="text-text-primary mt-3 inline-block text-xs font-medium underline underline-offset-2"
        >
          {localize('com_ui_balance_buy_pack')}
        </PurchaseLink>
      )}
    </div>
  );
}

export { Summary, TimePackStatus };
