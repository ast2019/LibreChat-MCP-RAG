import { useEffect } from 'react';
import { QueryKeys } from 'librechat-data-provider';
import { Button, Skeleton } from '@librechat/client';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import type { TPaymentOrder } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import { errorLabel, formatRial, GATEWAY_LABELS } from './format';
import { useBalanceDisplay } from '~/hooks/useBalanceSummary';
import { usePaymentOrderQuery } from '~/data-provider';
import { formatBalanceAmount } from '~/utils/balance';
import useLocalize from '~/hooks/useLocalize';

type View = 'success' | 'crediting' | 'pending' | 'failed';

/** The stored order decides the outcome; the redirect's `status` only covers a missing order. */
function viewOf(order: TPaymentOrder | undefined, status: string | null): View {
  if (order == null) {
    return status === 'pending' ? 'pending' : 'failed';
  }
  if (order.status === 'paid') {
    return order.credited ? 'success' : 'crediting';
  }
  return order.status === 'pending' ? 'pending' : 'failed';
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="text-text-primary font-medium">{children}</dd>
    </div>
  );
}

/** Where the gateway's return lands: the outcome, the receipt and a way forward. */
export default function Result() {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const orderId = params.get('order');
  const order = usePaymentOrderQuery(orderId);
  const { display, currency } = useBalanceDisplay();
  const view = viewOf(order.data, params.get('status'));
  const code = order.data?.errorCode ?? params.get('code');

  useEffect(() => {
    if (view === 'success') {
      queryClient.invalidateQueries([QueryKeys.balance]);
    }
  }, [view, queryClient]);

  if (orderId != null && order.isLoading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label={localize('com_ui_loading')}>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  const missing = orderId == null || order.isError;
  const heading: Record<View, string> = {
    success: localize('com_ui_payment_success'),
    crediting: localize('com_ui_payment_success'),
    pending: localize('com_ui_payment_pending'),
    failed: localize('com_ui_payment_failed'),
  };
  let detail: string | null = null;
  if (view === 'crediting') {
    detail = localize('com_ui_payment_crediting');
  } else if (view === 'pending') {
    detail = localize('com_ui_payment_pending_hint');
  } else if (view === 'failed') {
    detail =
      missing && orderId != null
        ? localize('com_ui_payment_error_order_not_found')
        : localize(errorLabel(code));
  }
  let icon = <XCircle className="text-text-destructive size-8" aria-hidden="true" />;
  if (view === 'success' || view === 'crediting') {
    icon = <CheckCircle2 className="text-status-success-strong size-8" aria-hidden="true" />;
  } else if (view === 'pending') {
    icon = <Clock className="text-text-warning size-8" aria-hidden="true" />;
  }
  const data = missing ? undefined : order.data;

  return (
    <section aria-labelledby="payment-result-title" className="space-y-5">
      <div
        className="flex items-start gap-3"
        role={view === 'failed' ? 'alert' : 'status'}
        data-testid="payment-result"
        data-view={view}
      >
        {icon}
        <div className="min-w-0 flex-1">
          <h1 id="payment-result-title" className="text-text-primary text-xl font-semibold">
            {heading[view]}
          </h1>
          {detail != null && <p className="text-text-secondary mt-1 text-sm">{detail}</p>}
        </div>
      </div>

      {data != null && (
        <dl className="border-border-light bg-surface-secondary divide-border-light divide-y rounded-xl border px-4">
          <Row label={localize('com_ui_payment_pack')}>{data.packLabel}</Row>
          <Row label={localize('com_ui_payment_amount')}>{formatRial(data.amountRial)}</Row>
          <Row label={localize('com_ui_payment_gateway')}>
            {localize(GATEWAY_LABELS[data.gateway])}
          </Row>
          {view === 'success' && (
            <Row label={localize('com_ui_payment_credit_added')}>
              {formatBalanceAmount(data.credits, display, currency)}
            </Row>
          )}
          {data.referenceId != null && (
            <Row label={localize('com_ui_payment_reference')}>
              <bdi dir="ltr" className="font-mono select-all">
                {data.referenceId}
              </bdi>
            </Row>
          )}
        </dl>
      )}

      <div className="flex flex-wrap gap-2">
        {view === 'failed' && (
          <Button asChild>
            <Link
              to={data != null ? `/payment?pack=${encodeURIComponent(data.packId)}` : '/payment'}
            >
              {localize('com_ui_payment_retry')}
            </Link>
          </Button>
        )}
        <Button asChild variant={view === 'failed' ? 'outline' : 'default'}>
          <Link to="/c/new">{localize('com_ui_payment_back_to_chat')}</Link>
        </Button>
      </div>
    </section>
  );
}
