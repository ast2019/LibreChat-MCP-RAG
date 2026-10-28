import { CREDITS_PER_USD } from 'librechat-data-provider';
import type { TServiceStatus, TServiceHealth } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks/useLocalize';
import type useLocalize from '~/hooks/useLocalize';
import type { CurrencyConfig } from '~/utils';
import { formatLocal, formatUsd } from '~/components/Billing/format';

type Localize = ReturnType<typeof useLocalize>;

export const SERVICE_NAME_KEYS: Record<TServiceStatus['id'], TranslationKeys> = {
  serper: 'com_admin_status_service_serper',
  serpapi: 'com_admin_status_service_serpapi',
  tavily: 'com_admin_status_service_tavily',
  searxng: 'com_admin_status_service_searxng',
  openrouter: 'com_admin_status_service_openrouter',
  sms: 'com_admin_status_service_sms',
  payments: 'com_admin_status_service_payments',
  ollama: 'com_admin_status_service_ollama',
};

export const HEALTH_KEYS: Record<TServiceHealth, TranslationKeys> = {
  ok: 'com_admin_status_health_ok',
  warning: 'com_admin_status_health_warning',
  exhausted: 'com_admin_status_health_exhausted',
  error: 'com_admin_status_health_error',
  unconfigured: 'com_admin_status_health_unconfigured',
};

export const formatNumber = (value: number, locale: string, digits = 0): string =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);

const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;

/** Decimal sizes as Ollama reports them: «۴٫۷ گیگابایت» / "4.7 GB". */
export function formatBytes(bytes: number, locale: string): string {
  let value = Math.max(0, bytes);
  let index = 0;
  while (value >= 1000 && index < BYTE_UNITS.length - 1) {
    value /= 1000;
    index += 1;
  }
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: BYTE_UNITS[index],
    unitDisplay: 'short',
    maximumFractionDigits: index === 0 ? 0 : 1,
  }).format(value);
}

export const formatPercent = (value: number, locale: string): string =>
  new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(value / 100);

/**
 * An amount in its service's unit: dollars (with the display currency, e.g. Toman, when one is
 * configured), Rial shown as Toman, or a count of searches/credits.
 */
export function formatAmount(
  value: number,
  unit: TServiceStatus['unit'],
  { locale, currency, localize }: { locale: string; currency?: CurrencyConfig; localize: Localize },
): string {
  if (unit === 'usd') {
    const credits = value * CREDITS_PER_USD;
    const local = formatLocal(credits, currency);
    return local != null ? `${formatUsd(credits)} · ${local}` : formatUsd(credits);
  }
  if (unit === 'rial') {
    return localize('com_admin_status_unit_toman', { 0: formatNumber(value / 10, locale) });
  }
  if (unit === 'searches') {
    return localize('com_admin_status_unit_searches', { 0: formatNumber(value, locale) });
  }
  return localize('com_admin_status_unit_credits', { 0: formatNumber(value, locale) });
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/** «۵ دقیقه پیش» / "in 3 hours"; under a minute reads as now. */
export function formatRelative(iso: string, now: number, locale: string): string {
  const diff = new Date(iso).getTime() - now;
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (Math.abs(diff) >= size) {
      return format.format(Math.round(diff / size), unit);
    }
  }
  return format.format(0, 'second');
}

export function formatDate(iso: string, locale: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
}

export function formatDateTime(iso: string, locale: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Services that need an admin's attention, worst first. */
export function getAttention(services: TServiceStatus[]): {
  exhausted: TServiceStatus[];
  low: TServiceStatus[];
} {
  return {
    exhausted: services.filter((row) => row.health === 'exhausted' || row.health === 'error'),
    low: services.filter((row) => row.health === 'warning'),
  };
}
