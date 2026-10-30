import type { TPersianToolsConfig } from 'librechat-data-provider';
import type { CalendarKind, DateView, YMD } from './calendar';
import type { DigitStyle } from './normalize';
import type { Holiday } from './holidays';
import {
  isoOf,
  toJdn,
  parseYMD,
  weekdayOf,
  todayJdn,
  jdnToSolar,
  describeDay,
  SOLAR_MONTHS,
  addSolarMonths,
  SOLAR_YEAR_MAX,
  SOLAR_YEAR_MIN,
  toPersianDigits,
  solarMonthLength,
} from './calendar';
import { holidaysIn, holidaysOn, listedYears, indexListedHolidays, WEEKEND_DAYS } from './holidays';
import { PERSIAN_TEXT_MAX_CHARS } from './definitions';
import { normalizePersianText } from './normalize';

export type CalendarOperation = 'today' | 'convert' | 'add' | 'difference' | 'month' | 'holidays';

export interface CalendarInput {
  operation?: string;
  date?: string;
  calendar?: string;
  other_date?: string;
  days?: number;
  months?: number;
  year?: number;
  month?: number;
}

export type ToolOutcome<T> = { ok: true; value: T } | { ok: false; error: string };

/** The longest span the tool walks day by day (working days, a year of holidays). */
const MAX_SPAN_DAYS = 3_660;

const ISLAMIC_NOTE =
  "Calculated (Umm al-Qura). Iran's official lunar date follows the moon sighting and can differ by a day.";

const CALENDARS: readonly CalendarKind[] = ['solar_hijri', 'gregorian', 'islamic'];

type DayResult = DateView & { holidays?: Holiday[]; weekend?: true };

function dayResult(jdn: number, listed: Map<string, string[]>): DayResult {
  const view = describeDay(jdn);
  const solar = jdnToSolar(jdn);
  const holidays = holidaysOn(solar.year, solar.month, solar.day, listed);
  return {
    ...view,
    ...(holidays.length > 0 && { holidays }),
    ...(WEEKEND_DAYS.has(weekdayOf(jdn)) && { weekend: true as const }),
  };
}

function readCalendar(value: string | undefined): CalendarKind | null {
  if (value == null || value === '') {
    return 'solar_hijri';
  }
  return CALENDARS.find((calendar) => calendar === value) ?? null;
}

function readDate(
  value: string | undefined,
  calendar: CalendarKind,
  field: string,
): ToolOutcome<number> {
  if (value == null || value.trim() === '') {
    return { ok: false, error: `\`${field}\` is required, as YYYY-MM-DD in ${calendar}.` };
  }
  const parsed = parseYMD(value);
  const jdn = parsed != null ? toJdn(parsed, calendar) : null;
  if (jdn == null) {
    return {
      ok: false,
      error: `\`${field}\` "${value}" is not a ${calendar} date; use YYYY-MM-DD.`,
    };
  }
  return { ok: true, value: jdn };
}

function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function readSolarYearMonth(
  input: CalendarInput,
  today: YMD,
  requireMonth: boolean,
): ToolOutcome<{ year: number; month?: number }> {
  const year = input.year ?? today.year;
  if (!isWholeNumber(year) || year < SOLAR_YEAR_MIN || year > SOLAR_YEAR_MAX) {
    return { ok: false, error: `\`year\` must be a Solar Hijri year such as ${today.year}.` };
  }
  if (input.month == null) {
    return requireMonth
      ? { ok: true, value: { year, month: today.month } }
      : { ok: true, value: { year } };
  }
  if (!isWholeNumber(input.month) || input.month < 1 || input.month > 12) {
    return { ok: false, error: '`month` must be 1 to 12.' };
  }
  return { ok: true, value: { year, month: input.month } };
}

function countWorkingDays(from: number, to: number, listed: Map<string, string[]>): number {
  const [start, end] = from <= to ? [from, to] : [to, from];
  let count = 0;
  for (let jdn = start + 1; jdn <= end; jdn += 1) {
    const solar = jdnToSolar(jdn);
    if (WEEKEND_DAYS.has(weekdayOf(jdn))) {
      continue;
    }
    if (holidaysOn(solar.year, solar.month, solar.day, listed).length > 0) {
      continue;
    }
    count += 1;
  }
  return count;
}

function missingListNote(years: Iterable<number>, entered: Set<number>): string | undefined {
  const missing = [...new Set(years)].filter((year) => !entered.has(year));
  if (missing.length === 0) {
    return undefined;
  }
  return `Only the fixed Solar Hijri holidays are known for ${missing.join(', ')}: the official lunar holidays of that year have not been entered by the admin. Do not guess them.`;
}

/** Runs one calendar request. Pure apart from `now`, so the answer is reproducible. */
export function runCalendar(
  input: CalendarInput,
  { now, config }: { now: Date; config: Pick<TPersianToolsConfig, 'timezone' | 'holidays'> },
): ToolOutcome<Record<string, unknown>> {
  const listed = indexListedHolidays(config.holidays);
  const entered = listedYears(listed);
  const todayNumber = todayJdn(now, config.timezone);
  const today = jdnToSolar(todayNumber);
  const calendar = readCalendar(input.calendar);
  if (calendar == null) {
    return { ok: false, error: '`calendar` must be solar_hijri, gregorian or islamic.' };
  }
  const operation = input.operation as CalendarOperation | undefined;

  if (operation === 'today') {
    return {
      ok: true,
      value: {
        today: dayResult(todayNumber, listed),
        timezone: config.timezone,
        islamic_note: ISLAMIC_NOTE,
      },
    };
  }

  if (operation === 'convert') {
    const date = readDate(input.date, calendar, 'date');
    if (!date.ok) {
      return date;
    }
    return { ok: true, value: { date: dayResult(date.value, listed), islamic_note: ISLAMIC_NOTE } };
  }

  if (operation === 'add') {
    const date = readDate(input.date, calendar, 'date');
    if (!date.ok) {
      return date;
    }
    const days = input.days ?? 0;
    const months = input.months ?? 0;
    if (!isWholeNumber(days) || !isWholeNumber(months)) {
      return { ok: false, error: '`days` and `months` must be whole numbers.' };
    }
    if (Math.abs(days) > 366_000 || Math.abs(months) > 12_000) {
      return { ok: false, error: '`days` or `months` is too large.' };
    }
    let jdn = date.value;
    if (months !== 0) {
      const moved = addSolarMonths(jdnToSolar(jdn), months);
      const movedJdn = toJdn(moved, 'solar_hijri');
      if (movedJdn == null) {
        return { ok: false, error: 'The result is outside the supported years.' };
      }
      jdn = movedJdn;
    }
    jdn += days;
    const resultSolar = jdnToSolar(jdn);
    if (resultSolar.year < SOLAR_YEAR_MIN || resultSolar.year > SOLAR_YEAR_MAX) {
      return { ok: false, error: 'The result is outside the supported years.' };
    }
    return {
      ok: true,
      value: {
        from: dayResult(date.value, listed),
        added: { months, days },
        result: dayResult(jdn, listed),
        islamic_note: ISLAMIC_NOTE,
      },
    };
  }

  if (operation === 'difference') {
    const from = readDate(input.date, calendar, 'date');
    if (!from.ok) {
      return from;
    }
    const to = readDate(input.other_date, calendar, 'other_date');
    if (!to.ok) {
      return to;
    }
    const days = to.value - from.value;
    const span = Math.abs(days);
    const years = [jdnToSolar(from.value).year, jdnToSolar(to.value).year];
    return {
      ok: true,
      value: {
        from: dayResult(from.value, listed),
        to: dayResult(to.value, listed),
        days,
        weeks: Math.trunc(span / 7),
        remaining_days: span % 7,
        ...(span <= MAX_SPAN_DAYS
          ? {
              working_days: countWorkingDays(from.value, to.value, listed),
              working_days_rule:
                'Counts the days after `date` up to and including `other_date`, without Fridays and official holidays.',
            }
          : { working_days_note: 'Working days are counted for spans up to ten years only.' }),
        holidays_note: missingListNote(years, entered),
      },
    };
  }

  if (operation === 'month') {
    const target = readSolarYearMonth(input, today, true);
    if (!target.ok) {
      return target;
    }
    const { year, month = today.month } = target.value;
    const first = toJdn({ year, month, day: 1 }, 'solar_hijri');
    if (first == null) {
      return { ok: false, error: 'That month is outside the supported years.' };
    }
    const length = solarMonthLength(year, month);
    const days = Array.from({ length }, (_, index) => {
      const jdn = first + index;
      const view = dayResult(jdn, listed);
      return {
        day: index + 1,
        weekday: view.weekday,
        gregorian: view.gregorian,
        islamic: view.islamic,
        ...(view.holidays && { holidays: view.holidays.map((holiday) => holiday.title) }),
        ...(view.weekend && { weekend: true }),
      };
    });
    return {
      ok: true,
      value: {
        month: isoOf({ year, month, day: 1 }).slice(0, 7),
        month_text: `${SOLAR_MONTHS[month - 1]} ${toPersianDigits(year)}`,
        days_in_month: length,
        days,
        holidays_note: missingListNote([year], entered),
        islamic_note: ISLAMIC_NOTE,
      },
    };
  }

  if (operation === 'holidays') {
    const target = readSolarYearMonth(input, today, false);
    if (!target.ok) {
      return target;
    }
    const { year, month } = target.value;
    const holidays = holidaysIn(year, month, listed).map((holiday) => {
      const parsed = parseYMD(holiday.date) as YMD;
      const view = describeDay(toJdn(parsed, 'solar_hijri') as number);
      return {
        ...holiday,
        weekday: view.weekday,
        gregorian: view.gregorian,
        text: view.solar_hijri_text,
      };
    });
    return {
      ok: true,
      value: {
        year,
        ...(month != null && { month }),
        holidays,
        weekly_holiday: 'جمعه',
        holidays_note: missingListNote([year], entered),
      },
    };
  }

  return {
    ok: false,
    error: '`operation` must be today, convert, add, difference, month or holidays.',
  };
}

export interface NormalizeInput {
  text?: string;
  digits?: string;
}

export function runNormalize(input: NormalizeInput): ToolOutcome<Record<string, unknown>> {
  if (typeof input.text !== 'string' || input.text === '') {
    return { ok: false, error: '`text` is required.' };
  }
  if (input.text.length > PERSIAN_TEXT_MAX_CHARS) {
    return {
      ok: false,
      error: `\`text\` is longer than ${PERSIAN_TEXT_MAX_CHARS} characters; send it in parts.`,
    };
  }
  const digits: DigitStyle =
    input.digits === 'persian' || input.digits === 'latin' ? input.digits : 'keep';
  const result = normalizePersianText(input.text, { digits });
  return {
    ok: true,
    value: {
      text: result.text,
      changed: result.text !== input.text,
      changes: result.changes,
      protected_segments: result.protectedSegments,
    },
  };
}
