/**
 * Solar Hijri (jalali), Gregorian and Islamic dates as Julian day numbers.
 *
 * The Solar Hijri conversion is the 33-year arithmetic algorithm of jalaali-js (MIT, Behrang
 * Noruzi Niya), checked against ICU's persian calendar for every day from 1950 to 2100.
 * Islamic dates are calculated (Umm al-Qura through ICU); Iran's official lunar date follows
 * the moon sighting and can differ by a day.
 */

export type CalendarKind = 'solar_hijri' | 'gregorian' | 'islamic';

export interface YMD {
  year: number;
  month: number;
  day: number;
}

const JALALI_BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394,
  2456, 3178,
];

/** Years the algorithm is exact for, kept well inside its supported range. */
export const SOLAR_YEAR_MIN = 1;
export const SOLAR_YEAR_MAX = 3000;

const div = (a: number, b: number): number => Math.trunc(a / b);
const mod = (a: number, b: number): number => a - Math.trunc(a / b) * b;

function jalCal(jy: number): { leap: number; gy: number; march: number } {
  const last = JALALI_BREAKS[JALALI_BREAKS.length - 1];
  if (jy < JALALI_BREAKS[0] || jy >= last) {
    throw new RangeError(`Solar Hijri year ${jy} is out of range`);
  }
  const gy = jy + 621;
  let leapJ = -14;
  let jp = JALALI_BREAKS[0];
  let jump = 0;
  for (let i = 1; i < JALALI_BREAKS.length; i += 1) {
    const jm = JALALI_BREAKS[i];
    jump = jm - jp;
    if (jy < jm) {
      break;
    }
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) {
    leapJ += 1;
  }
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) {
    n = n - jump + div(jump + 4, 33) * 33;
  }
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) {
    leap = 4;
  }
  return { leap, gy, march };
}

export function gregorianToJdn({ year, month, day }: YMD): number {
  const d =
    div((year + div(month - 8, 6) + 100100) * 1461, 4) +
    div(153 * mod(month + 9, 12) + 2, 5) +
    day -
    34840408;
  return d - div(div(year + 100100 + div(month - 8, 6), 100) * 3, 4) + 752;
}

export function jdnToGregorian(jdn: number): YMD {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const day = div(mod(i, 153), 5) + 1;
  const month = mod(div(i, 153), 12) + 1;
  const year = div(j, 1461) - 100100 + div(8 - month, 6);
  return { year, month, day };
}

export function isSolarLeapYear(year: number): boolean {
  return jalCal(year).leap === 0;
}

export function solarMonthLength(year: number, month: number): number {
  if (month <= 6) {
    return 31;
  }
  if (month <= 11) {
    return 30;
  }
  return isSolarLeapYear(year) ? 30 : 29;
}

export function solarToJdn({ year, month, day }: YMD): number {
  const r = jalCal(year);
  return (
    gregorianToJdn({ year: r.gy, month: 3, day: r.march }) +
    (month - 1) * 31 -
    div(month, 7) * (month - 7) +
    day -
    1
  );
}

export function jdnToSolar(jdn: number): YMD {
  const gy = jdnToGregorian(jdn).year;
  let year = gy - 621;
  const r = jalCal(year);
  let k = jdn - gregorianToJdn({ year: gy, month: 3, day: r.march });
  if (k >= 0) {
    if (k <= 185) {
      return { year, month: 1 + div(k, 31), day: mod(k, 31) + 1 };
    }
    k -= 186;
  } else {
    year -= 1;
    k += 179;
    if (r.leap === 1) {
      k += 1;
    }
  }
  return { year, month: 7 + div(k, 30), day: mod(k, 30) + 1 };
}

const ISLAMIC_FORMAT = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

/** The Julian day of 1970-01-01, to turn day numbers into `Date`s. */
const UNIX_EPOCH_JDN = 2440588;
const DAY_MS = 86_400_000;

export function jdnToDate(jdn: number): Date {
  return new Date((jdn - UNIX_EPOCH_JDN) * DAY_MS);
}

export function jdnToIslamic(jdn: number): YMD {
  const parts = ISLAMIC_FORMAT.formatToParts(jdnToDate(jdn));
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: read('year'), month: read('month'), day: read('day') };
}

/** Islamic epoch (1 Muharram 1 AH, civil) as a Julian day; anchors the search below. */
const ISLAMIC_EPOCH_JDN = 1948440;

export function islamicToJdn(date: YMD): number {
  const estimate =
    ISLAMIC_EPOCH_JDN +
    Math.floor((date.year - 1) * 354.36707) +
    Math.floor((date.month - 1) * 29.530589) +
    date.day -
    1;
  for (let offset = 0; offset <= 45; offset += 1) {
    for (const candidate of offset === 0 ? [estimate] : [estimate + offset, estimate - offset]) {
      const found = jdnToIslamic(candidate);
      if (found.year === date.year && found.month === date.month && found.day === date.day) {
        return candidate;
      }
    }
  }
  throw new RangeError(`${date.year}-${date.month}-${date.day} is not an Islamic date`);
}

function isValidGregorian({ year, month, day }: YMD): boolean {
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  const back = jdnToGregorian(gregorianToJdn({ year, month, day }));
  return back.year === year && back.month === month && back.day === day;
}

function isValidSolar({ year, month, day }: YMD): boolean {
  if (year < SOLAR_YEAR_MIN || year > SOLAR_YEAR_MAX || month < 1 || month > 12 || day < 1) {
    return false;
  }
  return day <= solarMonthLength(year, month);
}

/** The Julian day of a date in the given calendar, or null when the date does not exist. */
export function toJdn(date: YMD, calendar: CalendarKind): number | null {
  if (![date.year, date.month, date.day].every(Number.isInteger)) {
    return null;
  }
  try {
    if (calendar === 'solar_hijri') {
      return isValidSolar(date) ? solarToJdn(date) : null;
    }
    if (calendar === 'gregorian') {
      return isValidGregorian(date) ? gregorianToJdn(date) : null;
    }
    if (date.month < 1 || date.month > 12 || date.day < 1 || date.day > 30) {
      return null;
    }
    return islamicToJdn(date);
  } catch {
    return null;
  }
}

const DIGITS: Record<string, string> = {
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
};

/** `1405-08-08`, `۱۴۰۵/۸/۸` or `1405.8.8` as year, month and day; null for anything else. */
export function parseYMD(value: string): YMD | null {
  const latin = value.trim().replace(/[۰-۹٠-٩]/g, (digit) => DIGITS[digit] ?? digit);
  const match = /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(latin);
  if (!match) {
    return null;
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export const SOLAR_MONTHS = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
];

export const ISLAMIC_MONTHS = [
  'محرم',
  'صفر',
  'ربیع‌الاول',
  'ربیع‌الثانی',
  'جمادی‌الاول',
  'جمادی‌الثانی',
  'رجب',
  'شعبان',
  'رمضان',
  'شوال',
  'ذی‌القعده',
  'ذی‌الحجه',
];

const GREGORIAN_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Indexed by `Date#getUTCDay()`, Sunday first. */
export const WEEKDAYS_FA = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** 0 = Sunday … 6 = Saturday */
export function weekdayOf(jdn: number): number {
  return mod(jdn + 1, 7);
}

const pad = (value: number, length = 2) => String(value).padStart(length, '0');
export const isoOf = ({ year, month, day }: YMD): string =>
  `${pad(year, 4)}-${pad(month)}-${pad(day)}`;

export function toPersianDigits(value: string | number): string {
  return String(value).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
}

export interface DateView {
  solar_hijri: string;
  solar_hijri_text: string;
  gregorian: string;
  gregorian_text: string;
  islamic: string;
  islamic_text: string;
  weekday: string;
}

/** One day in all three calendars, as ISO dates and as words. */
export function describeDay(jdn: number): DateView {
  const solar = jdnToSolar(jdn);
  const gregorian = jdnToGregorian(jdn);
  const islamic = jdnToIslamic(jdn);
  const weekday = weekdayOf(jdn);
  return {
    solar_hijri: isoOf(solar),
    solar_hijri_text: `${WEEKDAYS_FA[weekday]} ${toPersianDigits(solar.day)} ${SOLAR_MONTHS[solar.month - 1]} ${toPersianDigits(solar.year)}`,
    gregorian: isoOf(gregorian),
    gregorian_text: `${WEEKDAYS_EN[weekday]}, ${gregorian.day} ${GREGORIAN_MONTHS[gregorian.month - 1]} ${gregorian.year}`,
    islamic: isoOf(islamic),
    islamic_text: `${toPersianDigits(islamic.day)} ${ISLAMIC_MONTHS[islamic.month - 1]} ${toPersianDigits(islamic.year)}`,
    weekday: WEEKDAYS_FA[weekday],
  };
}

/** Today's Julian day in a time zone; an unknown zone falls back to Tehran. */
export function todayJdn(now: Date, timeZone: string): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-u-ca-gregory-nu-latn', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(now);
  } catch {
    return todayJdn(now, 'Asia/Tehran');
  }
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return gregorianToJdn({ year: read('year'), month: read('month'), day: read('day') });
}

/** A Solar Hijri date moved by whole months and years, with the day kept inside the month. */
export function addSolarMonths(date: YMD, months: number): YMD {
  const index = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = (((index % 12) + 12) % 12) + 1;
  return { year, month, day: Math.min(date.day, solarMonthLength(year, month)) };
}
