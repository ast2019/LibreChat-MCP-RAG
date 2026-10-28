import { useEffect, useId, useMemo, useState } from 'react';
import { CreditCard, Package } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Button, EmptyState, Radio, Skeleton, Spinner } from '@librechat/client';
import type { TPaymentGateway } from 'librechat-data-provider';
import { usePaymentCheckoutMutation, usePaymentOptionsQuery } from '~/data-provider';
import { GATEWAY_LABELS, errorLabel, formatRial, readErrorCode } from './format';
import useLocalize from '~/hooks/useLocalize';
import cn from '~/utils/cn';

interface CheckoutProps {
  /** Sends the browser to the gateway; replaced in tests */
  onRedirect?: (url: string) => void;
}

const redirect = (url: string) => window.location.assign(url);

/**
 * Pack purchase: the buyer picks a pack and an enabled gateway, the server prices the order,
 * and the browser leaves for the gateway. Prices come from the server, never the client.
 */
export default function Checkout({ onRedirect = redirect }: CheckoutProps) {
  const localize = useLocalize();
  const packsId = useId();
  const gatewayId = useId();
  const [params] = useSearchParams();
  const options = usePaymentOptionsQuery();
  const checkout = usePaymentCheckoutMutation();
  const [packId, setPackId] = useState<string | null>(params.get('pack'));
  const [gateway, setGateway] = useState<TPaymentGateway | null>(null);

  const packs = options.data?.packs ?? [];
  const gateways = useMemo(() => options.data?.gateways ?? [], [options.data?.gateways]);
  const selectedPack = packs.find((pack) => pack.id === packId);
  const selectedGateway = gateways.find((item) => item.id === gateway) ?? gateways[0];

  useEffect(() => {
    if (gateway == null && gateways.length > 0) {
      setGateway(gateways[0].id);
    }
  }, [gateway, gateways]);

  const pay = () => {
    if (selectedPack == null || selectedGateway == null) {
      return;
    }
    checkout.mutate(
      { packId: selectedPack.id, gateway: selectedGateway.id },
      { onSuccess: (data) => onRedirect(data.redirectUrl) },
    );
  };

  let body;
  if (options.isLoading) {
    body = (
      <div className="space-y-2" aria-busy="true" aria-label={localize('com_ui_loading')}>
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  } else if (options.isError) {
    body = (
      <div className="space-y-3">
        <p role="alert" className="text-text-destructive text-sm">
          {localize('com_ui_payment_load_error')}
        </p>
        <Button size="compact" variant="outline" onClick={() => options.refetch()}>
          {localize('com_ui_payment_retry')}
        </Button>
      </div>
    );
  } else if (options.data?.enabled !== true) {
    body = <EmptyState icon={CreditCard} title={localize('com_ui_payment_unavailable')} />;
  } else if (packs.length === 0) {
    body = <EmptyState icon={Package} title={localize('com_ui_payment_no_packs')} />;
  } else {
    const errorCode = checkout.isError ? readErrorCode(checkout.error) : undefined;
    const busy = checkout.isLoading || checkout.isSuccess;
    let payLabel = localize('com_ui_payment_pay_plain');
    if (busy) {
      payLabel = localize('com_ui_payment_redirecting');
    } else if (selectedPack != null) {
      payLabel = localize('com_ui_payment_pay', { 0: formatRial(selectedPack.amountRial) });
    }
    body = (
      <div className="space-y-6">
        <fieldset className="space-y-2">
          <legend id={packsId} className="text-text-primary mb-2 text-sm font-medium">
            {localize('com_ui_payment_choose_pack')}
          </legend>
          {packs.map((pack) => {
            const checked = pack.id === packId;
            return (
              <label
                key={pack.id}
                data-testid="payment-pack"
                className={cn(
                  'border-border-light bg-surface-secondary min-h-theme-target flex cursor-pointer items-center gap-3 rounded-xl border p-4',
                  'focus-within:ring-ring-primary focus-within:ring-2',
                  checked && 'border-border-heavy bg-surface-tertiary',
                )}
              >
                <input
                  type="radio"
                  name="payment-pack"
                  value={pack.id}
                  checked={checked}
                  disabled={busy}
                  onChange={() => setPackId(pack.id)}
                  className="size-4 shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span className="text-text-primary block text-sm font-medium">{pack.label}</span>
                  {pack.description != null && pack.description !== '' && (
                    <span className="text-text-secondary mt-0.5 block text-xs">
                      {pack.description}
                    </span>
                  )}
                </span>
                <span className="text-text-primary text-sm font-semibold whitespace-nowrap">
                  {formatRial(pack.amountRial)}
                </span>
              </label>
            );
          })}
        </fieldset>

        {gateways.length > 1 && (
          <div className="space-y-2">
            <h2 id={gatewayId} className="text-text-primary text-sm font-medium">
              {localize('com_ui_payment_choose_gateway')}
            </h2>
            <Radio
              aria-labelledby={gatewayId}
              options={gateways.map((item) => ({
                value: item.id,
                label: localize(GATEWAY_LABELS[item.id]),
              }))}
              value={selectedGateway?.id}
              onChange={(value) => setGateway(value as TPaymentGateway)}
              disabled={busy}
              wrap={true}
            />
          </div>
        )}
        {selectedGateway?.sandbox === true && (
          <p className="text-text-warning text-xs">{localize('com_ui_payment_sandbox')}</p>
        )}

        {checkout.isError && (
          <p role="alert" className="text-text-destructive text-sm">
            {localize(errorLabel(errorCode))}
          </p>
        )}

        <div className="space-y-2">
          <Button
            className="w-full sm:w-auto"
            disabled={selectedPack == null || selectedGateway == null || busy}
            aria-describedby={selectedPack == null ? `${packsId}-hint` : undefined}
            onClick={pay}
          >
            {busy && <Spinner className="me-2 size-4" aria-hidden="true" />}
            {payLabel}
          </Button>
          {selectedPack == null && (
            <p id={`${packsId}-hint`} className="text-text-secondary text-xs">
              {localize('com_ui_payment_select_hint')}
            </p>
          )}
          <p className="text-text-secondary text-xs">{localize('com_ui_payment_secure_note')}</p>
        </div>
      </div>
    );
  }

  return (
    <section aria-labelledby="payment-title" className="space-y-4">
      <h1 id="payment-title" className="text-text-primary text-xl font-semibold">
        {localize('com_ui_payment_title')}
      </h1>
      {body}
    </section>
  );
}
