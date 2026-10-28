import { PAYMENT_GATEWAYS, paymentsConfigSchema } from 'librechat-data-provider';
import type { TPaymentGateway, TPaymentsStartupConfig } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { GatewayConfigs } from './types';

export type PaymentsEnv = Record<string, string | undefined>;

/** A gateway as the admin status panel and the registry see it. */
export interface GatewaySettings<K extends TPaymentGateway = TPaymentGateway> {
  id: K;
  enabled: boolean;
  /** Its credential resolved to a non-empty value */
  configured: boolean;
  sandbox: boolean;
  /** Present only when enabled and configured */
  config?: GatewayConfigs[K];
}

export interface PaymentSettings {
  enabled: boolean;
  /** Public origin of this server, without a trailing slash; unset means no callback is possible */
  callbackBaseUrl?: string;
  orderTtlMinutes: number;
  requestTimeoutMs: number;
  description?: string;
  gateways: { [K in TPaymentGateway]: GatewaySettings<K> };
}

/** Secrets may only be read from these variables, so a config override cannot read others. */
const SECRET_ENV = /^\$\{((?:ZARINPAL|IDPAY|PAYMENT)_[A-Z0-9_]+)\}$/;

function resolveSecret(value: string | undefined, env: PaymentsEnv): string {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  const match = SECRET_ENV.exec(trimmed);
  if (match) {
    return env[match[1]]?.trim() ?? '';
  }
  return trimmed.startsWith('${') ? '' : trimmed;
}

function normalizeOrigin(value: string | undefined): string | undefined {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim())) {
    return undefined;
  }
  return value.trim().replace(/\/+$/, '');
}

/**
 * `payments` from the app config. Admin overrides merge in unvalidated, so the block is
 * re-parsed; an invalid block counts as disabled rather than half-applied.
 */
export function resolvePaymentSettings(
  appConfig: AppConfig | undefined | null,
  env: PaymentsEnv = process.env,
): PaymentSettings {
  const parsed = paymentsConfigSchema.safeParse(appConfig?.config?.payments ?? {});
  const raw = parsed.success ? parsed.data : paymentsConfigSchema.parse({});
  const enabled = parsed.success && raw.enabled;

  const zarinpal = raw.gateways.zarinpal;
  const merchantId = resolveSecret(zarinpal?.merchantId, env);
  const idpay = raw.gateways.idpay;
  const apiKey = resolveSecret(idpay?.apiKey, env);

  const zarinpalOn = enabled && zarinpal?.enabled === true;
  const idpayOn = enabled && idpay?.enabled === true;

  return {
    enabled,
    callbackBaseUrl: normalizeOrigin(raw.callbackBaseUrl ?? env.DOMAIN_SERVER),
    orderTtlMinutes: raw.orderTtlMinutes,
    requestTimeoutMs: raw.requestTimeoutMs,
    ...(raw.description != null && { description: raw.description }),
    gateways: {
      zarinpal: {
        id: 'zarinpal',
        enabled: zarinpal?.enabled === true,
        configured: merchantId !== '',
        sandbox: zarinpal?.sandbox === true,
        ...(zarinpalOn &&
          merchantId !== '' && {
            config: {
              merchantId,
              sandbox: zarinpal?.sandbox === true,
              currency: zarinpal?.currency ?? 'IRR',
            },
          }),
      },
      idpay: {
        id: 'idpay',
        enabled: idpay?.enabled === true,
        configured: apiKey !== '',
        sandbox: idpay?.sandbox === true,
        ...(idpayOn && apiKey !== '' && { config: { apiKey, sandbox: idpay?.sandbox === true } }),
      },
    },
  };
}

/** Gateways a buyer can use now: payments on, gateway on, credential set, callback reachable. */
export function getUsableGateways(settings: PaymentSettings): GatewaySettings[] {
  if (!settings.enabled || settings.callbackBaseUrl == null) {
    return [];
  }
  return PAYMENT_GATEWAYS.map((id) => settings.gateways[id] as GatewaySettings).filter(
    (gateway) => gateway.config != null,
  );
}

/** The `/api/config` field; undefined while no gateway is usable, so the old CTA stays. */
export function getPaymentsStartupConfig(
  appConfig: AppConfig | undefined | null,
  env: PaymentsEnv = process.env,
): TPaymentsStartupConfig | undefined {
  const gateways = getUsableGateways(resolvePaymentSettings(appConfig, env)).map(({ id }) => id);
  return gateways.length > 0 ? { enabled: true, gateways } : undefined;
}
