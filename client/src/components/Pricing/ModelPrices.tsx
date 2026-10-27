import { memo, useId, useMemo } from 'react';
import { Skeleton } from '@librechat/client';
import { EModelEndpoint } from 'librechat-data-provider';
import type { TModelSpec, TModelTokenomics } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import type { CurrencyConfig } from '~/utils';
import { useGetStartupConfig, useTokenConfigQuery } from '~/data-provider';
import { getBlendedPrice, getCostTier, perThousandWords } from './tier';
import { useBalanceDisplay } from '~/hooks/useBalanceSummary';
import useLocalize from '~/hooks/useLocalize';
import { getSpecTokenomics } from './rates';
import { formatCost } from '~/utils/tokens';
import CostBadge from './CostBadge';
import cn from '~/utils/cn';

interface PriceRow {
  spec: TModelSpec;
  rates?: TModelTokenomics;
}

interface PriceGroup {
  name: string;
  rows: PriceRow[];
}

/** Specs the menu offers, grouped in menu order; agent-backed specs have no model price. */
function groupSpecs(
  specs: TModelSpec[] | undefined,
  map: Parameters<typeof getSpecTokenomics>[1],
): PriceGroup[] {
  const groups = new Map<string, PriceGroup>();
  for (const spec of specs ?? []) {
    if (spec.showInMenu === false || !spec.preset?.model) {
      continue;
    }
    if (spec.preset.endpoint === EModelEndpoint.agents) {
      continue;
    }
    const name = spec.group ?? '';
    let group = groups.get(name);
    if (group == null) {
      group = { name, rows: [] };
      groups.set(name, group);
    }
    group.rows.push({ spec, rates: getSpecTokenomics(spec, map) });
  }
  return [...groups.values()];
}

function PriceCell({
  rate,
  free,
  unknown,
  currency,
}: {
  rate: number | null | undefined;
  free: string;
  unknown: string;
  currency?: CurrencyConfig;
}) {
  if (rate == null || !Number.isFinite(rate)) {
    return <span className="text-text-tertiary">{unknown}</span>;
  }
  if (rate === 0) {
    return <span>{free}</span>;
  }
  return <span>{formatCost(rate, currency)}</span>;
}

/**
 * What each model the menu offers costs: input and output per 1M tokens and the price of
 * ~1000 words of a typical exchange, in the display currency (Toman) with the endpoint's
 * price multiplier applied — the same rates billing charges.
 */
function ModelPrices({ className }: { className?: string }) {
  const localize = useLocalize();
  const headingId = useId();
  const { currency } = useBalanceDisplay();
  const { data: startupConfig } = useGetStartupConfig();
  const { data: tokenConfig, isLoading, isError } = useTokenConfigQuery();
  const specs = startupConfig?.modelSpecs?.list;
  const groups = useMemo(() => groupSpecs(specs, tokenConfig), [specs, tokenConfig]);

  if (!specs?.length) {
    return null;
  }

  const free = localize('com_ui_price_free');
  const unknown = localize('com_ui_price_unknown');

  let body: ReactNode;
  if (isLoading) {
    body = (
      <div className="space-y-2" aria-busy="true" data-testid="model-prices-loading">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  } else if (isError) {
    body = (
      <p className="text-text-destructive text-xs" role="alert">
        {localize('com_ui_model_prices_error')}
      </p>
    );
  } else if (groups.length === 0) {
    return null;
  } else {
    body = (
      <>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-text-secondary text-start">
                <th scope="col" className="py-1 pe-2 text-start font-normal">
                  {localize('com_ui_model_prices_model')}
                </th>
                <th scope="col" className="px-2 py-1 text-start font-normal">
                  {localize('com_ui_model_prices_input')}
                </th>
                <th scope="col" className="px-2 py-1 text-start font-normal">
                  {localize('com_ui_model_prices_output')}
                </th>
                <th scope="col" className="py-1 ps-2 text-start font-normal">
                  {localize('com_ui_model_prices_words')}
                </th>
              </tr>
            </thead>
            {groups.map((group) => (
              <tbody key={group.name} className="border-border-light border-t">
                {group.name !== '' && (
                  <tr>
                    <th
                      scope="rowgroup"
                      colSpan={4}
                      className="text-text-secondary pt-2 pb-1 text-start font-medium"
                    >
                      {group.name}
                    </th>
                  </tr>
                )}
                {group.rows.map(({ spec, rates }) => {
                  const blended = getBlendedPrice(rates);
                  return (
                    <tr key={spec.name} className="text-text-primary">
                      <th scope="row" className="py-1 pe-2 text-start font-normal">
                        <span className="inline-flex items-center gap-1.5">
                          {spec.label}
                          <CostBadge tier={getCostTier(rates)} />
                        </span>
                      </th>
                      <td className="px-2 py-1 whitespace-nowrap">
                        <PriceCell
                          rate={rates?.prompt}
                          free={free}
                          unknown={unknown}
                          currency={currency}
                        />
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap">
                        <PriceCell
                          rate={rates?.completion}
                          free={free}
                          unknown={unknown}
                          currency={currency}
                        />
                      </td>
                      <td className="py-1 ps-2 whitespace-nowrap">
                        <PriceCell
                          rate={blended == null ? null : perThousandWords(blended)}
                          free={free}
                          unknown={unknown}
                          currency={currency}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
        <p className="text-text-secondary text-xs">{localize('com_ui_model_prices_note')}</p>
      </>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      data-testid="model-prices"
      className={cn('space-y-2', className)}
    >
      <h3 id={headingId} className="text-text-primary text-sm font-medium">
        {localize('com_ui_model_prices')}
      </h3>
      {body}
    </section>
  );
}

export default memo(ModelPrices);
