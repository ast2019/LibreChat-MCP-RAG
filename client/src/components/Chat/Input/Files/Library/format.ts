import type { TFile } from 'librechat-data-provider';

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

function scale(bytes: number): [number, string] {
  if (bytes >= GB) {
    return [bytes / GB, 'gigabyte'];
  }
  if (bytes >= MB) {
    return [bytes / MB, 'megabyte'];
  }
  if (bytes >= KB) {
    return [bytes / KB, 'kilobyte'];
  }
  return [bytes, 'byte'];
}

/** A size in the UI language's digits and unit names (e.g. «۱٫۲ مگابایت»). */
export function formatFileBytes(bytes: number, lang?: string): string {
  const value = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  const [amount, unit] = scale(value);
  try {
    return new Intl.NumberFormat(lang, {
      style: 'unit',
      unit,
      unitDisplay: 'short',
      maximumFractionDigits: amount >= 10 || unit === 'byte' ? 0 : 1,
    }).format(amount);
  } catch {
    return `${amount.toFixed(1)} ${unit}`;
  }
}

/** The file's last change, in the UI language's calendar (Persian dates for `fa`). */
export function formatFileDate(file: TFile, lang?: string): string {
  const raw = file.updatedAt ?? file.createdAt;
  if (raw == null) {
    return '';
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  try {
    return date.toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return date.toLocaleDateString();
  }
}

export function formatCount(count: number, lang?: string): string {
  try {
    return new Intl.NumberFormat(lang).format(count);
  } catch {
    return String(count);
  }
}

export function fileTime(file: TFile): number {
  const raw = file.updatedAt ?? file.createdAt;
  const time = raw != null ? new Date(raw).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}
