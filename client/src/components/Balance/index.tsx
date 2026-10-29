import useBalanceSummary from '~/hooks/useBalanceSummary';
import { PurchaseLink, usePurchaseTarget } from './Purchase';
import useLocalize from '~/hooks/useLocalize';
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
  if (!enabled) {
    return null;
  }
  const offerPurchase = purchase != null && state.status === 'success' && state.summary.showPrices;
  if (!offerPurchase) {
    return <Summary state={state} currency={currency} className={className} />;
  }
  return (
    <div className={className}>
      <Summary state={state} currency={currency} />
      <PurchaseLink
        target={purchase}
        className="text-text-primary mt-3 inline-block text-xs font-medium underline underline-offset-2"
      >
        {localize('com_ui_balance_buy_pack')}
      </PurchaseLink>
    </div>
  );
}

export { Summary };
