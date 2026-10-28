import type { TPaymentGateway } from 'librechat-data-provider';
import type { DriverContext, GatewayConfigs, PaymentDriver } from './types';
import type { PaymentSettings } from './config';
import { createZarinpalDriver } from './drivers/zarinpal';
import { createIdpayDriver } from './drivers/idpay';

export type PaymentDriverFactories = {
  [K in TPaymentGateway]: (config: GatewayConfigs[K], ctx: DriverContext) => PaymentDriver;
};

/** Every driver this server ships; a new gateway is one entry here plus its config schema. */
export const PAYMENT_DRIVER_FACTORIES: PaymentDriverFactories = {
  zarinpal: createZarinpalDriver,
  idpay: createIdpayDriver,
};

export interface PaymentDriverRegistry {
  /** The driver for a gateway that is enabled and configured; null otherwise. */
  get(gateway: TPaymentGateway, settings: PaymentSettings): PaymentDriver | null;
}

export function createPaymentDriverRegistry({
  fetch: fetchImpl = globalThis.fetch,
  factories = PAYMENT_DRIVER_FACTORIES,
}: {
  fetch?: typeof fetch;
  factories?: PaymentDriverFactories;
} = {}): PaymentDriverRegistry {
  function build<K extends TPaymentGateway>(
    gateway: K,
    settings: PaymentSettings,
  ): PaymentDriver | null {
    const config = settings.gateways[gateway].config as GatewayConfigs[K] | undefined;
    if (!settings.enabled || config == null) {
      return null;
    }
    const factory = factories[gateway] as (
      c: GatewayConfigs[K],
      ctx: DriverContext,
    ) => PaymentDriver;
    return factory(config, { fetch: fetchImpl, timeoutMs: settings.requestTimeoutMs });
  }
  return { get: build };
}
