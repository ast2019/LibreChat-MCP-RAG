/** A chart the model describes as data, drawn as a native, editable Word or PowerPoint chart. */
export type ChartKind = 'column' | 'bar' | 'line' | 'area' | 'pie' | 'doughnut';

export const CHART_KINDS: readonly ChartKind[] = [
  'column',
  'bar',
  'line',
  'area',
  'pie',
  'doughnut',
];

export interface ChartSeries {
  name: string;
  values: (number | null)[];
}

export interface ChartSpec {
  type: ChartKind;
  title?: string;
  categories: string[];
  series: ChartSeries[];
  /** Shown after the values, such as «٪» or «میلیون تومان» */
  unit?: string;
  stacked?: boolean;
}

export type ChartResult = { ok: true; chart: ChartSpec } | { ok: false; error: string };

const MAX_CATEGORIES = 40;
const MAX_SERIES = 8;

const DIGITS: Record<string, string> = Object.fromEntries(
  [...'۰۱۲۳۴۵۶۷۸۹']
    .map((digit, index) => [digit, String(index)])
    .concat([...'٠١٢٣٤٥٦٧٨٩'].map((digit, index) => [digit, String(index)])),
);

/** A number written with Latin, Persian or Arabic digits, thousands separators and «٫»; null otherwise. */
export function readNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const latin = value
    .trim()
    .replace(/[۰-۹٠-٩]/g, (digit) => DIGITS[digit])
    .replace(/[٬,\s]/g, '')
    .replace(/٫/g, '.')
    .replace(/[%٪]$/, '');
  if (latin === '' || !/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(latin)) {
    return null;
  }
  const number = Number(latin);
  return Number.isFinite(number) ? number : null;
}

const KIND_ALIASES: Record<string, ChartKind> = {
  column: 'column',
  columns: 'column',
  bar: 'bar',
  bars: 'bar',
  horizontal_bar: 'bar',
  line: 'line',
  area: 'area',
  pie: 'pie',
  doughnut: 'doughnut',
  donut: 'doughnut',
};

/**
 * Checks a chart the model wrote. Values may come as numbers or digit strings in any script;
 * every series needs a value per category at most, and pie and doughnut charts take one series of
 * values that are not negative. The error says what to fix, for the model to retry.
 */
export function readChart(value: unknown): ChartResult {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'a chart is an object with type, categories and series' };
  }
  const raw = value as Record<string, unknown>;
  const type = KIND_ALIASES[String(raw.type ?? 'column').toLowerCase()];
  if (!type) {
    return { ok: false, error: `chart type must be one of ${CHART_KINDS.join(', ')}` };
  }
  if (!Array.isArray(raw.categories) || raw.categories.length === 0) {
    return { ok: false, error: 'a chart needs at least one category' };
  }
  if (raw.categories.length > MAX_CATEGORIES) {
    return { ok: false, error: `a chart takes at most ${MAX_CATEGORIES} categories` };
  }
  const categories = raw.categories.map((category) => String(category ?? '').trim());
  const rawSeries = Array.isArray(raw.series) ? raw.series : [];
  if (rawSeries.length === 0) {
    return { ok: false, error: 'a chart needs at least one series of values' };
  }
  if (rawSeries.length > MAX_SERIES) {
    return { ok: false, error: `a chart takes at most ${MAX_SERIES} series` };
  }
  const series: ChartSeries[] = [];
  for (const [index, entry] of rawSeries.entries()) {
    const item = (entry ?? {}) as Record<string, unknown>;
    if (!Array.isArray(item.values)) {
      return { ok: false, error: `series ${index + 1} has no values array` };
    }
    if (item.values.length > categories.length) {
      return {
        ok: false,
        error: `series ${index + 1} has ${item.values.length} values for ${categories.length} categories`,
      };
    }
    const values = item.values.map((entryValue) => readNumber(entryValue));
    if (values.every((entryValue) => entryValue == null)) {
      return { ok: false, error: `series ${index + 1} has no numeric values` };
    }
    series.push({ name: String(item.name ?? '').trim() || `${index + 1}`, values });
  }
  if (type === 'pie' || type === 'doughnut') {
    if (series.length > 1) {
      return { ok: false, error: `a ${type} chart takes one series` };
    }
    if (series[0].values.some((entryValue) => entryValue != null && entryValue < 0)) {
      return { ok: false, error: `a ${type} chart cannot show negative values` };
    }
  }
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : undefined;
  const unit = typeof raw.unit === 'string' && raw.unit.trim() ? raw.unit.trim() : undefined;
  return {
    ok: true,
    chart: {
      type,
      categories,
      series,
      ...(title ? { title } : {}),
      ...(unit ? { unit } : {}),
      ...(raw.stacked === true ? { stacked: true } : {}),
    },
  };
}

/** A chart from the JSON inside a ```chart block of the Markdown. */
export function readChartSource(source: string): ChartResult {
  try {
    return readChart(JSON.parse(source));
  } catch {
    return { ok: false, error: 'the chart block is not valid JSON' };
  }
}
