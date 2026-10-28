import type { TPaymentGateway } from 'librechat-data-provider';

export interface GatewayHealthEntry {
  lastSuccessAt?: Date;
  lastFailureAt?: Date;
  /** Stable driver code of the last failure; never gateway text */
  lastFailureCode?: string;
}

/** Outcomes of gateway calls in this process: reachable and answering, or not. */
export interface GatewayHealth {
  recordSuccess(gateway: TPaymentGateway): void;
  recordFailure(gateway: TPaymentGateway, code: string): void;
  get(gateway: TPaymentGateway): GatewayHealthEntry;
}

export function createGatewayHealth(now: () => Date = () => new Date()): GatewayHealth {
  const entries = new Map<TPaymentGateway, GatewayHealthEntry>();
  const entry = (gateway: TPaymentGateway) => {
    let value = entries.get(gateway);
    if (value == null) {
      value = {};
      entries.set(gateway, value);
    }
    return value;
  };
  return {
    recordSuccess(gateway) {
      entry(gateway).lastSuccessAt = now();
    },
    recordFailure(gateway, code) {
      const value = entry(gateway);
      value.lastFailureAt = now();
      value.lastFailureCode = code;
    },
    get(gateway) {
      return { ...(entries.get(gateway) ?? {}) };
    },
  };
}

let shared: GatewayHealth | undefined;

/** The process-wide tracker the payment routes record into and the status panel reads. */
export function getSharedGatewayHealth(): GatewayHealth {
  shared ??= createGatewayHealth();
  return shared;
}
