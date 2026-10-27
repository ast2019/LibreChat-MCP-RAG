import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleDollarSign } from 'lucide-react';
import type { CostTier } from './tier';
import useLocalize from '~/hooks/useLocalize';
import cn from '~/utils/cn';

interface CostBadgeProps {
  tier: CostTier | null;
  /** Extra detail for pointer hover, e.g. the price of ~1000 words */
  title?: string;
  className?: string;
}

const MAX_TIER = 4;

/** Localized digits (Persian writes ۳, not 3); malformed language tags make `Intl` throw. */
function formatDigit(value: number, language?: string): string {
  try {
    return new Intl.NumberFormat(language).format(value);
  } catch {
    return String(value);
  }
}

/** «رایگان» for a free model, otherwise one to four coins from cheap to expensive. */
function CostBadge({ tier, title, className }: CostBadgeProps) {
  const localize = useLocalize();
  const { i18n } = useTranslation();
  if (tier == null) {
    return null;
  }
  if (tier === 0) {
    return (
      <span
        title={title}
        className={cn(
          'border-border-light text-text-secondary text-3xs shrink-0 rounded border px-1 leading-4 font-normal',
          className,
        )}
      >
        {localize('com_ui_price_free')}
      </span>
    );
  }
  const label = localize('com_ui_price_tier', {
    0: formatDigit(tier, i18n.language),
    1: formatDigit(MAX_TIER, i18n.language),
  });
  return (
    <span
      role="img"
      aria-label={label}
      title={title != null ? `${label} · ${title}` : label}
      className={cn('text-text-secondary inline-flex shrink-0 items-center', className)}
      data-testid="cost-badge"
      data-tier={tier}
    >
      {Array.from({ length: tier }, (_, index) => (
        <CircleDollarSign key={index} className="size-3" aria-hidden="true" />
      ))}
    </span>
  );
}

export default memo(CostBadge);
