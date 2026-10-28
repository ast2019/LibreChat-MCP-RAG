import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useGetStartupConfig } from '~/data-provider';

/** Where "Buy a pack" goes: the in-app purchase page when a payment gateway is usable, else
 *  the deployment's `balance.purchaseUrl`; null when neither exists. */
export type PurchaseTarget = { kind: 'internal'; to: string } | { kind: 'external'; href: string };

export function usePurchaseTarget(): PurchaseTarget | null {
  const { data: startupConfig } = useGetStartupConfig();
  if (startupConfig?.payments?.enabled === true) {
    return { kind: 'internal', to: '/payment' };
  }
  const href = startupConfig?.balance?.purchaseUrl;
  return href != null && href !== '' ? { kind: 'external', href } : null;
}

/** An anchor for a purchase target; external pages open in a new tab. */
export function PurchaseLink({
  target,
  className,
  children,
}: {
  target: PurchaseTarget;
  className?: string;
  children: ReactNode;
}) {
  if (target.kind === 'internal') {
    return (
      <Link to={target.to} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <a href={target.href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}
