---
name: persian-calendar
display-title: تقویم و تاریخ فارسی
description: Dates in Iran, computed exactly with the persian_calendar tool. Use for today's date (امروز چندم است), converting between Solar Hijri (شمسی), Gregorian (میلادی) and Islamic (قمری) dates, weekdays, adding or subtracting days and months (۱۰ روز دیگر، پنجشنبه هفته بعد), the gap between two dates and working days, a month view, and Iran's official holidays (تعطیلات رسمی).
allowed-tools:
  - persian_calendar
license: MIT
---

# تقویم و تاریخ فارسی

## The one rule

Never work out a date in your head. Every date you state, convert, count or name a weekday for
comes from a `persian_calendar` call made in this turn. Copy dates from the tool's output.

## Reading the request

- A year like 13xx or 14xx with a month number or a Solar month name (فروردین … اسفند) is Solar
  Hijri. 19xx or 20xx is Gregorian. A lunar month name (محرم، رمضان، ذی‌الحجه …) or the word
  «قمری» means Islamic.
- When the year is 14xx and nothing says «قمری», treat it as Solar Hijri.
- Relative dates («فردا»، «پس‌فردا»، «هفته بعد»، «۱۰ روز دیگر»، «سه ماه بعد»): call `today`, then
  `add` from today's `solar_hijri` with the needed `days` or `months`.
- A named weekday («پنجشنبه آینده»): call `today`, count the days to that weekday, call `add`, and
  check that the result's `weekday` is the one asked for.
- Persian month numbers: فروردین ۱، اردیبهشت ۲، خرداد ۳، تیر ۴، مرداد ۵، شهریور ۶، مهر ۷،
  آبان ۸، آذر ۹، دی ۱۰، بهمن ۱۱، اسفند ۱۲.
- «امروز» is Tehran time unless the user names another place.

## Answering

- Answer in Persian with Persian digits, using the tool's `solar_hijri_text`, for example:
  «پنجشنبه ۸ آبان ۱۴۰۵». Add the Gregorian date in parentheses when it helps.
- Give the Islamic date only when asked or for a religious occasion, and say it is calculated:
  «(قمری محاسباتی؛ ممکن است با تقویم رسمی یک روز فرق کند)».
- For a gap between dates, give the number of days, and weeks plus days when that reads better.
  Working days exclude Fridays and official holidays; Thursday counts as a working day. Say so.
- Keep it short: the date, then one line of context if needed.

## Holidays

- Report only the holidays the tool returns. Friday is the weekly holiday.
- When the output has `holidays_note`, the official lunar holidays of that year have not been
  entered: say that the official lunar holidays of that year are not available here, and do not
  guess them from memory.

## What this skill does not do

It does not read or change anyone's personal calendar. If the user wants an event added, give
the exact date and time, and say that adding events to their calendar is not connected.
