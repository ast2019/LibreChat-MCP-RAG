import { phoneLoginConfigSchema } from 'librechat-data-provider';
import type { TPhoneLoginConfig } from 'librechat-data-provider';
import type { PhoneOtpPolicy } from './types';
import { isEnabled } from '~/utils';

export interface PhoneLoginEnv {
  KAVENEGAR_API_KEY?: string;
  ALLOW_REGISTRATION?: string;
  [name: string]: string | undefined;
}

/**
 * A yaml value that may be an environment reference (`${KAVENEGAR_TEMPLATE}`): the variable's
 * value, or `undefined` when it is unset or empty, so an unset reference never reaches Kavenegar.
 */
export function resolvePhoneConfigValue(
  value: string | undefined,
  env: PhoneLoginEnv,
): string | undefined {
  const match = value?.trim().match(/^\$\{([A-Z0-9_]+)\}$/);
  const resolved = match ? env[match[1]] : value;
  return resolved?.trim() || undefined;
}

export interface ResolvedPhoneLogin {
  /** Configured on, the provider has credentials, and a template or sender is set. */
  enabled: boolean;
  allowRegistration: boolean;
  policy: PhoneOtpPolicy;
  template?: string;
  sender?: string;
  limits: { perPhonePerHour: number; perIpPerHour: number };
}

const DEFAULTS: TPhoneLoginConfig = phoneLoginConfigSchema.parse({});

/**
 * Resolves `registration.phone` with schema defaults, so a config that bypassed parsing (tests,
 * stored overrides) gets the same levers. Invalid input resolves to disabled.
 */
export function resolvePhoneLoginConfig(
  raw: Partial<TPhoneLoginConfig> | undefined,
  env: PhoneLoginEnv,
): ResolvedPhoneLogin {
  const parsed = raw == null ? null : phoneLoginConfigSchema.safeParse(raw);
  const config = parsed?.success ? parsed.data : { ...DEFAULTS, enabled: false };
  const hasCredentials = config.provider === 'kavenegar' && Boolean(env.KAVENEGAR_API_KEY?.trim());
  const template = resolvePhoneConfigValue(config.template, env);
  const sender = resolvePhoneConfigValue(config.sender, env);
  /** Without a Verify Lookup template or a sender line no code can be sent, so the form stays hidden. */
  const canSend = Boolean(template || sender);
  return {
    enabled: config.enabled && hasCredentials && canSend,
    allowRegistration: config.allowRegistration ?? isEnabled(env.ALLOW_REGISTRATION),
    policy: {
      codeTtlSeconds: config.codeTtlSeconds,
      resendCooldownSeconds: config.resendCooldownSeconds,
      maxAttempts: config.maxAttempts,
    },
    template,
    sender,
    limits: {
      perPhonePerHour: config.maxRequestsPerPhonePerHour,
      perIpPerHour: config.maxRequestsPerIpPerHour,
    },
  };
}

/** Startup-config flags for `GET /api/config` (pre- and post-login). */
export function getPhoneLoginStartupFlags(
  raw: Partial<TPhoneLoginConfig> | undefined,
  env: PhoneLoginEnv,
): { phoneLoginEnabled: boolean; phoneRegistrationEnabled: boolean } {
  const resolved = resolvePhoneLoginConfig(raw, env);
  return {
    phoneLoginEnabled: resolved.enabled,
    phoneRegistrationEnabled: resolved.enabled && resolved.allowRegistration,
  };
}
