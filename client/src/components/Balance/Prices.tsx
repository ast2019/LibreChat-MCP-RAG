import { memo, useId } from 'react';
import type { TBalancePack } from 'librechat-data-provider';
import type { CurrencyConfig } from '~/utils';
import { formatPackPrice } from '~/utils/balance';
import useLocalize from '~/hooks/useLocalize';
import cn from '~/utils/cn';

interface PricesProps {
  packs: TBalancePack[];
  currency?: CurrencyConfig;
  purchaseUrl?: string;
  className?: string;
}

/** The packs on sale and their price in the display currency, offered before a purchase. */
function Prices({ packs, currency, purchaseUrl, className }: PricesProps) {
  const localize = useLocalize();
  const headingId = useId();
  const rows = packs
    .map((pack) => ({ pack, price: formatPackPrice(pack.credits, currency) }))
    .filter((row): row is { pack: TBalancePack; price: string } => row.price != null);

  if (rows.length === 0) {
    return null;
  }

  return (
    <section
      aria-labelledby={headingId}
      data-testid="balance-prices"
      className={cn('space-y-1.5', className)}
    >
      <h3 id={headingId} className="text-text-primary text-sm font-medium">
        {localize('com_ui_balance_prices')}
      </h3>
      <ul className="space-y-1">
        {rows.map(({ pack, price }) => (
          <li key={pack.id} className="flex items-center justify-between gap-2 text-xs">
            <span className="text-text-secondary min-w-0 truncate">{pack.label}</span>
            <span className="text-text-primary font-medium whitespace-nowrap">{price}</span>
          </li>
        ))}
      </ul>
      {purchaseUrl != null && purchaseUrl !== '' && (
        <a
          href={purchaseUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-text-primary inline-block text-xs font-medium underline underline-offset-2"
        >
          {localize('com_ui_balance_buy_pack')}
        </a>
      )}
    </section>
  );
}

export default memo(Prices);
