import { runCalendar, runNormalize } from './service';

/** 08:00 UTC on Friday 30 October 2026, which is 8 Aban 1405 in Tehran. */
const now = new Date(Date.UTC(2026, 9, 30, 8, 0));
const config = { timezone: 'Asia/Tehran', holidays: [] };

/** The successful value, typed by the test that knows which operation produced it. */
const ok = <T = Record<string, unknown>>(outcome: ReturnType<typeof runCalendar>): T => {
  if (!outcome.ok) {
    throw new Error(outcome.error);
  }
  return outcome.value as T;
};

describe('runCalendar', () => {
  it('reports today in all three calendars with the lunar caveat', () => {
    const value = ok(runCalendar({ operation: 'today' }, { now, config }));
    expect(value.today).toMatchObject({
      solar_hijri: '1405-08-08',
      gregorian: '2026-10-30',
      weekday: 'جمعه',
      weekend: true,
    });
    expect(value.islamic_note).toMatch(/can differ by a day/);
  });

  it('converts from any calendar, defaulting to Solar Hijri', () => {
    expect(
      ok(runCalendar({ operation: 'convert', date: '۱۴۰۵/۱/۱' }, { now, config })).date,
    ).toMatchObject({ gregorian: '2026-03-21', holidays: [{ title: 'عید نوروز' }] });
    expect(
      ok<{ date: { solar_hijri: string } }>(
        runCalendar(
          { operation: 'convert', date: '2026-03-21', calendar: 'gregorian' },
          { now, config },
        ),
      ).date.solar_hijri,
    ).toBe('1405-01-01');
  });

  it('adds months then days and keeps the day inside the month', () => {
    const value = ok<{ result: { solar_hijri: string } }>(
      runCalendar({ operation: 'add', date: '1404-06-31', months: 1, days: 1 }, { now, config }),
    );
    expect(value.result.solar_hijri).toBe('1404-08-01');
  });

  it('counts days and working days between two dates', () => {
    const value = ok(
      runCalendar(
        { operation: 'difference', date: '1405-01-01', other_date: '1405-01-15' },
        { now, config },
      ),
    );
    expect(value.days).toBe(14);
    expect(value.weeks).toBe(2);
    /** 2..15 Farvardin: holidays 2,3,4,12,13 and Fridays 7 and 14 are off. */
    expect(value.working_days).toBe(7);
    expect(value.holidays_note).toMatch(/not been entered/);
  });

  it('adds the admin-listed lunar holidays and stops warning for that year', () => {
    const listed = {
      timezone: 'Asia/Tehran',
      holidays: [{ date: '1405-01-10', title: 'عید فطر' }],
    };
    const value = ok<{ holidays: Array<{ title: string }>; holidays_note?: string }>(
      runCalendar({ operation: 'holidays', year: 1405, month: 1 }, { now, config: listed }),
    );
    expect(value.holidays.map((holiday) => holiday.title)).toEqual([
      'عید نوروز',
      'عید نوروز',
      'عید نوروز',
      'عید نوروز',
      'عید فطر',
      'روز جمهوری اسلامی',
      'روز طبیعت',
    ]);
    expect(value.holidays_note).toBeUndefined();
  });

  it('lays out a month with weekdays and holidays', () => {
    const value = ok<{ days_in_month: number; days: unknown[]; month_text: string }>(
      runCalendar({ operation: 'month', year: 1404, month: 12 }, { now, config }),
    );
    expect(value.days_in_month).toBe(29);
    expect(value.days).toHaveLength(29);
    expect(value.days[28]).toMatchObject({ day: 29, holidays: ['ملی شدن صنعت نفت'] });
    expect(value.month_text).toBe('اسفند ۱۴۰۴');
  });

  it.each([
    [{ operation: 'convert', date: '1404-12-30' }, /not a solar_hijri date/],
    [{ operation: 'convert' }, /`date` is required/],
    [{ operation: 'convert', date: '1405-01-01', calendar: 'julian' }, /`calendar` must be/],
    [{ operation: 'add', date: '1405-01-01', days: 1.5 }, /whole numbers/],
    [{ operation: 'holidays', month: 13 }, /`month` must be 1 to 12/],
    [{ operation: 'teleport' }, /`operation` must be/],
  ])('explains a bad request %#', (input, message) => {
    const outcome = runCalendar(input, { now, config });
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error).toMatch(message);
  });
});

describe('runNormalize', () => {
  it('returns the fixed text and what changed', () => {
    const outcome = runNormalize({ text: 'كتاب ها' });
    expect(outcome).toEqual({
      ok: true,
      value: {
        text: 'کتاب\u200cها',
        changed: true,
        changes: { letters: 1, half_space: 1 },
        protected_segments: 0,
      },
    });
  });

  it('refuses empty and oversized text', () => {
    expect(runNormalize({ text: '' }).ok).toBe(false);
    expect(runNormalize({ text: 'ا'.repeat(20_001) }).ok).toBe(false);
  });
});
