import type { TPersianHoliday } from 'librechat-data-provider';
import { isoOf, parseYMD, solarMonthLength, toJdn } from './calendar';

export interface Holiday {
  /** Solar Hijri date, `YYYY-MM-DD` */
  date: string;
  title: string;
  /** `fixed`: the same Solar Hijri day every year; `listed`: from the admin's yearly list */
  source: 'fixed' | 'listed';
}

/** Official holidays fixed to a Solar Hijri month and day. */
const FIXED_SOLAR_HOLIDAYS: ReadonlyArray<{ month: number; day: number; title: string }> = [
  { month: 1, day: 1, title: 'عید نوروز' },
  { month: 1, day: 2, title: 'عید نوروز' },
  { month: 1, day: 3, title: 'عید نوروز' },
  { month: 1, day: 4, title: 'عید نوروز' },
  { month: 1, day: 12, title: 'روز جمهوری اسلامی' },
  { month: 1, day: 13, title: 'روز طبیعت' },
  { month: 3, day: 14, title: 'رحلت امام خمینی' },
  { month: 3, day: 15, title: 'قیام ۱۵ خرداد' },
  { month: 11, day: 22, title: 'پیروزی انقلاب اسلامی' },
  { month: 12, day: 29, title: 'ملی شدن صنعت نفت' },
];

/** Friday is the weekly holiday. `Date#getUTCDay()` numbering. */
export const WEEKEND_DAYS: ReadonlySet<number> = new Set([5]);

/** Normalizes the admin's list once: valid dates only, keyed by Solar Hijri ISO date. */
export function indexListedHolidays(listed: readonly TPersianHoliday[]): Map<string, string[]> {
  const byDate = new Map<string, string[]>();
  for (const holiday of listed) {
    const date = parseYMD(holiday.date);
    if (date == null || toJdn(date, 'solar_hijri') == null) {
      continue;
    }
    const iso = isoOf(date);
    byDate.set(iso, [...(byDate.get(iso) ?? []), holiday.title]);
  }
  return byDate;
}

/** The years the admin has entered any holiday for, so a missing year can be said aloud. */
export function listedYears(listed: Map<string, string[]>): Set<number> {
  const years = new Set<number>();
  for (const iso of listed.keys()) {
    years.add(Number(iso.slice(0, 4)));
  }
  return years;
}

export function holidaysOn(
  year: number,
  month: number,
  day: number,
  listed: Map<string, string[]>,
): Holiday[] {
  const iso = isoOf({ year, month, day });
  const fixed = FIXED_SOLAR_HOLIDAYS.filter(
    (holiday) => holiday.month === month && holiday.day === day,
  ).map((holiday) => ({ date: iso, title: holiday.title, source: 'fixed' as const }));
  const fromList = (listed.get(iso) ?? []).map((title) => ({
    date: iso,
    title,
    source: 'listed' as const,
  }));
  return [...fixed, ...fromList];
}

/** Every holiday in a Solar Hijri month, or in the whole year when `month` is absent. */
export function holidaysIn(
  year: number,
  month: number | undefined,
  listed: Map<string, string[]>,
): Holiday[] {
  const months = month != null ? [month] : Array.from({ length: 12 }, (_, index) => index + 1);
  const result: Holiday[] = [];
  for (const current of months) {
    const length = solarMonthLength(year, current);
    for (let day = 1; day <= length; day += 1) {
      result.push(...holidaysOn(year, current, day, listed));
    }
  }
  return result;
}
