import { useEffect, useId, useState } from 'react';
import { PAYMENT_GATEWAYS, PAYMENT_ORDER_STATUSES } from 'librechat-data-provider';
import { Button, Input, Radio, Skeleton, Spinner, useToastContext } from '@librechat/client';
import type {
  TPaymentGateway,
  TAdminPaymentOrder,
  TPaymentOrderStatus,
} from 'librechat-data-provider';
import {
  useAdminPaymentsQuery,
  useAdminPaymentVerifyMutation,
  useAdminPaymentsSummaryQuery,
  useAdminPaymentsReconcileMutation,
} from '~/data-provider';
import { GATEWAY_LABELS, STATUS_LABELS, formatDate, formatRial } from './format';
import { Kpi } from '~/components/Billing/parts';
import useLocalize from '~/hooks/useLocalize';
import cn from '~/utils/cn';

const PAGE_SIZE = 25;
const SEARCH_DELAY_MS = 300;
const COLUMN_COUNT = 8;
const ALL = 'all';

const STATUS_TONE: Record<TPaymentOrderStatus, string> = {
  paid: 'text-status-success-strong',
  pending: 'text-text-warning',
  failed: 'text-text-destructive',
  canceled: 'text-text-secondary',
  expired: 'text-text-secondary',
};

const canCheck = (order: TAdminPaymentOrder) =>
  order.status === 'pending' ||
  order.status === 'expired' ||
  (order.status === 'paid' && !order.credited);

/** «پرداخت‌ها»: gateway orders with filters, today/month totals and re-verification. */
export default function AdminPayments() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const statusId = useId();
  const gatewayId = useId();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<TPaymentOrderStatus | typeof ALL>(ALL);
  const [gateway, setGateway] = useState<TPaymentGateway | typeof ALL>(ALL);
  const [offset, setOffset] = useState(0);
  const [checking, setChecking] = useState<string | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setOffset(0);
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  const orders = useAdminPaymentsQuery({
    status: status === ALL ? undefined : status,
    gateway: gateway === ALL ? undefined : gateway,
    search: search || undefined,
    limit: PAGE_SIZE,
    offset,
  });
  const summary = useAdminPaymentsSummaryQuery();
  const verify = useAdminPaymentVerifyMutation();
  const reconcile = useAdminPaymentsReconcileMutation();
  const total = orders.data?.total ?? 0;

  const check = (order: TAdminPaymentOrder) => {
    setChecking(order.id);
    verify.mutate(order.id, {
      onSuccess: (data) =>
        showToast({
          message: localize('com_admin_payments_verify_done', {
            0: localize(STATUS_LABELS[data.order.status]),
          }),
          status: 'success',
        }),
      onError: () =>
        showToast({ message: localize('com_admin_payments_action_error'), status: 'error' }),
      onSettled: () => setChecking(null),
    });
  };

  const checkAll = () =>
    reconcile.mutate(undefined, {
      onSuccess: (data) =>
        showToast({
          message: localize('com_admin_payments_reconcile_done', {
            0: String(data.checked),
            1: String(data.paid),
            2: String(data.expired),
          }),
          status: 'success',
        }),
      onError: () =>
        showToast({ message: localize('com_admin_payments_action_error'), status: 'error' }),
    });

  const totals = (key: 'today' | 'month') => {
    const row = summary.data?.[key];
    return row == null
      ? {}
      : {
          value: formatRial(row.amountRial),
          hint: localize('com_admin_payments_count', {
            0: new Intl.NumberFormat('fa-IR').format(row.count),
          }),
        };
  };

  return (
    <section aria-labelledby="admin-payments" className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="admin-payments" className="text-text-primary flex-1 text-sm font-medium">
          {localize('com_admin_payments_title')}
        </h2>
        <Button size="compact" variant="outline" onClick={checkAll} disabled={reconcile.isLoading}>
          {reconcile.isLoading && <Spinner className="me-1 size-4" aria-hidden="true" />}
          {localize('com_admin_payments_reconcile')}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="admin-payments-summary">
        <Kpi label={localize('com_admin_payments_today')} {...totals('today')} />
        <Kpi label={localize('com_admin_payments_month')} {...totals('month')} />
        <Kpi
          label={localize('com_admin_payments_pending')}
          value={
            summary.data != null
              ? new Intl.NumberFormat('fa-IR').format(summary.data.pending)
              : undefined
          }
        />
      </div>
      {summary.isError && (
        <p role="alert" className="text-text-destructive text-sm">
          {localize('com_admin_payments_error')}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <span id={statusId} className="text-text-secondary block text-xs">
            {localize('com_admin_payments_filter_status')}
          </span>
          <Radio
            aria-labelledby={statusId}
            size="sm"
            wrap={true}
            value={status}
            onChange={(value) => {
              setStatus(value as TPaymentOrderStatus | typeof ALL);
              setOffset(0);
            }}
            options={[
              { value: ALL, label: localize('com_admin_payments_all') },
              ...PAYMENT_ORDER_STATUSES.map((value) => ({
                value,
                label: localize(STATUS_LABELS[value]),
              })),
            ]}
          />
        </div>
        <div className="space-y-1">
          <span id={gatewayId} className="text-text-secondary block text-xs">
            {localize('com_admin_payments_filter_gateway')}
          </span>
          <Radio
            aria-labelledby={gatewayId}
            size="sm"
            value={gateway}
            onChange={(value) => {
              setGateway(value as TPaymentGateway | typeof ALL);
              setOffset(0);
            }}
            options={[
              { value: ALL, label: localize('com_admin_payments_all') },
              ...PAYMENT_GATEWAYS.map((value) => ({
                value,
                label: localize(GATEWAY_LABELS[value]),
              })),
            ]}
          />
        </div>
        <div className="w-full max-w-xs">
          <Input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={localize('com_admin_payments_search')}
            aria-label={localize('com_admin_payments_search')}
          />
        </div>
      </div>

      <div className="border-border-light overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="text-text-secondary text-xs">
            <tr className="border-border-light border-b">
              {(
                [
                  'com_admin_payments_col_date',
                  'com_admin_payments_col_user',
                  'com_admin_payments_col_pack',
                  'com_admin_payments_col_amount',
                  'com_admin_payments_col_gateway',
                  'com_admin_payments_col_status',
                  'com_admin_payments_col_reference',
                ] as const
              ).map((key) => (
                <th key={key} scope="col" className="px-4 py-2 text-start font-medium">
                  {localize(key)}
                </th>
              ))}
              <th scope="col" className="px-4 py-2">
                <span className="sr-only">{localize('com_admin_col_actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody aria-busy={orders.isLoading}>
            {orders.isLoading &&
              Array.from({ length: 3 }, (_, index) => (
                <tr key={index} className="border-border-light border-b last:border-0">
                  <td colSpan={COLUMN_COUNT} className="px-4 py-3">
                    <Skeleton className="h-4 w-full" />
                  </td>
                </tr>
              ))}
            {orders.isError && (
              <tr>
                <td colSpan={COLUMN_COUNT} className="text-text-destructive px-4 py-6 text-center">
                  <span role="alert">{localize('com_admin_payments_error')}</span>{' '}
                  <Button size="compact" variant="outline" onClick={() => orders.refetch()}>
                    {localize('com_ui_payment_retry')}
                  </Button>
                </td>
              </tr>
            )}
            {orders.data?.orders.length === 0 && (
              <tr>
                <td colSpan={COLUMN_COUNT} className="text-text-secondary px-4 py-6 text-center">
                  {localize('com_admin_payments_empty')}
                </td>
              </tr>
            )}
            {orders.data?.orders.map((order) => (
              <tr
                key={order.id}
                data-testid="admin-payment-row"
                className="border-border-light border-b last:border-0"
              >
                <td className="text-text-secondary px-4 py-2 whitespace-nowrap">
                  {formatDate(order.paidAt ?? order.createdAt)}
                </td>
                <td className="px-4 py-2">
                  <div className="text-text-primary">{order.user.name || '—'}</div>
                  <bdi dir="ltr" className="text-text-secondary text-xs">
                    {order.user.email ?? order.user.id}
                  </bdi>
                </td>
                <td className="text-text-secondary px-4 py-2">{order.packLabel}</td>
                <td className="text-text-primary px-4 py-2 whitespace-nowrap">
                  {formatRial(order.amountRial)}
                </td>
                <td className="text-text-secondary px-4 py-2">
                  {localize(GATEWAY_LABELS[order.gateway])}
                </td>
                <td className="px-4 py-2">
                  <span className={cn('font-medium', STATUS_TONE[order.status])}>
                    {localize(STATUS_LABELS[order.status])}
                  </span>
                  {order.status === 'paid' && !order.credited && (
                    <span className="text-text-warning block text-xs">
                      {localize('com_admin_payments_uncredited')}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2">
                  {order.referenceId != null ? (
                    <bdi dir="ltr" className="text-text-primary font-mono text-xs">
                      {order.referenceId}
                    </bdi>
                  ) : (
                    <span className="text-text-secondary">—</span>
                  )}
                  {order.cardPan != null && (
                    <bdi dir="ltr" className="text-text-secondary block font-mono text-xs">
                      {order.cardPan}
                    </bdi>
                  )}
                </td>
                <td className="px-4 py-2 text-end">
                  {canCheck(order) && (
                    <Button
                      size="compact"
                      variant="outline"
                      disabled={checking === order.id}
                      onClick={() => check(order)}
                    >
                      {checking === order.id && (
                        <Spinner className="me-1 size-4" aria-hidden="true" />
                      )}
                      {localize('com_admin_payments_verify')}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > PAGE_SIZE && (
        <nav
          aria-label={localize('com_admin_pagination')}
          className="flex items-center justify-end gap-2 text-sm"
        >
          <span className="text-text-secondary">
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} / {total}
          </span>
          <Button
            size="compact"
            variant="outline"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(offset - PAGE_SIZE, 0))}
          >
            {localize('com_ui_prev')}
          </Button>
          <Button
            size="compact"
            variant="outline"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            {localize('com_ui_next')}
          </Button>
        </nav>
      )}
    </section>
  );
}
