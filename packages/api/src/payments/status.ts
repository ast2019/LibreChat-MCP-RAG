import { PAYMENT_GATEWAYS } from 'librechat-data-provider';
import type { TPaymentGateway } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { GatewayHealth } from './health';
import type { PaymentsEnv } from './config';
import { resolvePaymentSettings } from './config';
import { getSharedGatewayHealth } from './health';

export interface PaymentGatewayReport {
  id: TPaymentGateway;
  /** `payments.enabled` and the gateway's own `enabled` */
  enabled: boolean;
  /** Its merchant id / API key resolved to a value */
  configured: boolean;
  sandbox: boolean;
  /** Enabled, configured and a callback origin is known: buyers can use it now */
  usable: boolean;
  /** ISO times of the last successful and failed gateway call or order */
  lastSuccessAt?: string;
  lastFailureAt?: string;
  /** Stable code of the last failure (e.g. `gateway_unreachable`), never gateway text */
  lastFailureCode?: string;
  /** Usable, and its last recorded call did not fail after its last success */
  healthy: boolean;
  /** Why it is not healthy: `not_enabled`, `not_configured`, `no_callback_url` or the last failure code */
  errorCode?: string;
}

/** Last paid/failed order per gateway, as `db.getPaymentGatewayActivity()` returns it. */
export interface PaymentGatewayActivity {
  gateway: string;
  lastPaidAt?: Date;
  lastFailedAt?: Date;
}

function latest(a?: Date, b?: Date): Date | undefined {
  if (a == null || b == null) {
    return a ?? b;
  }
  return a.getTime() >= b.getTime() ? a : b;
}

/**
 * One row per gateway the server has a driver for: whether it is configured/enabled/sandboxed
 * and when it last worked or failed. Secrets never leave this function. Times merge this
 * process's gateway calls (`health`) with stored order outcomes (`activity`, optional).
 */
export function getPaymentGatewaysStatus(
  appConfig: AppConfig | undefined | null,
  {
    env = process.env,
    health = getSharedGatewayHealth(),
    activity = [],
  }: { env?: PaymentsEnv; health?: GatewayHealth; activity?: PaymentGatewayActivity[] } = {},
): PaymentGatewayReport[] {
  const settings = resolvePaymentSettings(appConfig, env);
  return PAYMENT_GATEWAYS.map((id) => {
    const gateway = settings.gateways[id];
    const tracked = health.get(id);
    const stored = activity.find((row) => row.gateway === id);
    const lastSuccess = latest(tracked.lastSuccessAt, stored?.lastPaidAt);
    const lastFailure = latest(tracked.lastFailureAt, stored?.lastFailedAt);
    const enabled = settings.enabled && gateway.enabled;
    const usable = gateway.config != null && settings.callbackBaseUrl != null;
    const failing =
      lastFailure != null && (lastSuccess == null || lastFailure.getTime() > lastSuccess.getTime());
    let errorCode: string | undefined;
    if (!enabled) {
      errorCode = 'not_enabled';
    } else if (!gateway.configured) {
      errorCode = 'not_configured';
    } else if (!usable) {
      errorCode = 'no_callback_url';
    } else if (failing) {
      errorCode = tracked.lastFailureCode ?? 'gateway_failed';
    }
    return {
      id,
      enabled,
      configured: gateway.configured,
      sandbox: gateway.sandbox,
      usable,
      ...(lastSuccess && { lastSuccessAt: lastSuccess.toISOString() }),
      ...(lastFailure && { lastFailureAt: lastFailure.toISOString() }),
      ...(tracked.lastFailureCode != null && { lastFailureCode: tracked.lastFailureCode }),
      healthy: usable && !failing,
      ...(errorCode != null && { errorCode }),
    };
  });
}
