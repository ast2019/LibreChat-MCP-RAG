import useBalanceSummary from '~/hooks/useBalanceSummary';
import { useGetStartupConfig } from '~/data-provider';
import { usePurchaseTarget } from './Purchase';
import Summary from './Summary';
import Prices from './Prices';

/** The user's balance, or nothing when the deployment does not meter credits. */
export default function Balance({ className }: { className?: string }) {
  const { data: startupConfig } = useGetStartupConfig();
  const { enabled, state, currency } = useBalanceSummary();
  const purchase = usePurchaseTarget();
  if (!enabled) {
    return null;
  }
  const packs = startupConfig?.balance?.packs ?? [];
  const showPrices = state.status === 'success' && state.summary.showPrices && packs.length > 0;
  if (!showPrices) {
    return <Summary state={state} currency={currency} className={className} />;
  }
  return (
    <div className={className}>
      <Summary state={state} currency={currency} />
      <Prices
        packs={packs}
        currency={currency}
        purchase={purchase}
        className="border-border-light mt-3 border-t pt-3"
      />
    </div>
  );
}

export { Summary, Prices };
