import {
  toJdn,
  parseYMD,
  weekdayOf,
  todayJdn,
  jdnToSolar,
  describeDay,
  jdnToIslamic,
  solarToJdn,
  gregorianToJdn,
  jdnToGregorian,
  addSolarMonths,
  isSolarLeapYear,
  solarMonthLength,
} from './calendar';

const icuSolar = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

describe('Solar Hijri conversion', () => {
  it('agrees with ICU on every day of 1390 to 1420', () => {
    const start = solarToJdn({ year: 1390, month: 1, day: 1 });
    const end = solarToJdn({ year: 1421, month: 1, day: 1 });
    for (let jdn = start; jdn < end; jdn += 1) {
      const gregorian = jdnToGregorian(jdn);
      const date = new Date(Date.UTC(gregorian.year, gregorian.month - 1, gregorian.day));
      const parts = Object.fromEntries(icuSolar.formatToParts(date).map((p) => [p.type, p.value]));
      expect(jdnToSolar(jdn)).toEqual({
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
      });
    }
  });

  it.each([
    ['1405-01-01', '2026-03-21'],
    ['1404-01-01', '2025-03-21'],
    ['1403-12-30', '2025-03-20'],
    ['1405-08-08', '2026-10-30'],
    ['1399-12-30', '2021-03-20'],
  ])('converts %s to %s and back', (solar, gregorian) => {
    const s = parseYMD(solar)!;
    const g = parseYMD(gregorian)!;
    expect(toJdn(s, 'solar_hijri')).toBe(gregorianToJdn(g));
    expect(jdnToSolar(gregorianToJdn(g))).toEqual(s);
  });

  it('knows leap years and month lengths', () => {
    expect(isSolarLeapYear(1403)).toBe(true);
    expect(isSolarLeapYear(1404)).toBe(false);
    expect(solarMonthLength(1403, 12)).toBe(30);
    expect(solarMonthLength(1404, 12)).toBe(29);
    expect(solarMonthLength(1404, 6)).toBe(31);
    expect(solarMonthLength(1404, 7)).toBe(30);
  });

  it('rejects dates that do not exist', () => {
    expect(toJdn({ year: 1404, month: 12, day: 30 }, 'solar_hijri')).toBeNull();
    expect(toJdn({ year: 1404, month: 13, day: 1 }, 'solar_hijri')).toBeNull();
    expect(toJdn({ year: 1404, month: 7, day: 31 }, 'solar_hijri')).toBeNull();
    expect(toJdn({ year: 2025, month: 2, day: 29 }, 'gregorian')).toBeNull();
    expect(toJdn({ year: 2024, month: 2, day: 29 }, 'gregorian')).not.toBeNull();
  });
});

describe('dates in words', () => {
  it('names the weekday and writes Persian digits', () => {
    const jdn = gregorianToJdn({ year: 2026, month: 10, day: 30 });
    expect(weekdayOf(jdn)).toBe(5);
    expect(describeDay(jdn)).toMatchObject({
      solar_hijri: '1405-08-08',
      solar_hijri_text: 'جمعه ۸ آبان ۱۴۰۵',
      gregorian: '2026-10-30',
      gregorian_text: 'Friday, 30 October 2026',
      weekday: 'جمعه',
    });
  });

  it('round-trips Islamic dates through the calculated calendar', () => {
    const jdn = gregorianToJdn({ year: 2026, month: 10, day: 30 });
    const islamic = jdnToIslamic(jdn);
    expect(islamic.year).toBe(1448);
    expect(toJdn(islamic, 'islamic')).toBe(jdn);
  });

  it('reads Persian, Arabic and Latin digits with any separator', () => {
    expect(parseYMD('۱۴۰۵/۸/۸')).toEqual({ year: 1405, month: 8, day: 8 });
    expect(parseYMD('١٤٠٥-٠٨-٠٨')).toEqual({ year: 1405, month: 8, day: 8 });
    expect(parseYMD('1405.8.8')).toEqual({ year: 1405, month: 8, day: 8 });
    expect(parseYMD('8 Aban 1405')).toBeNull();
  });
});

describe('today and month arithmetic', () => {
  it('takes today in the configured time zone', () => {
    /** 21:00 UTC on 30 October is already 31 October in Tehran (UTC+3:30). */
    const now = new Date(Date.UTC(2026, 9, 30, 21, 0));
    expect(jdnToSolar(todayJdn(now, 'Asia/Tehran'))).toEqual({ year: 1405, month: 8, day: 9 });
    expect(jdnToSolar(todayJdn(now, 'UTC'))).toEqual({ year: 1405, month: 8, day: 8 });
    expect(todayJdn(now, 'Not/AZone')).toBe(todayJdn(now, 'Asia/Tehran'));
  });

  it('keeps the day inside the target month', () => {
    expect(addSolarMonths({ year: 1404, month: 6, day: 31 }, 1)).toEqual({
      year: 1404,
      month: 7,
      day: 30,
    });
    expect(addSolarMonths({ year: 1404, month: 11, day: 30 }, 1)).toEqual({
      year: 1404,
      month: 12,
      day: 29,
    });
    expect(addSolarMonths({ year: 1405, month: 1, day: 10 }, -1)).toEqual({
      year: 1404,
      month: 12,
      day: 10,
    });
    expect(addSolarMonths({ year: 1405, month: 1, day: 10 }, 24)).toEqual({
      year: 1407,
      month: 1,
      day: 10,
    });
  });
});
