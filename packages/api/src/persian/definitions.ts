import { PersianTools } from 'librechat-data-provider';

export interface PersianToolDefinition {
  name: PersianTools;
  description: string;
  schema: Record<string, unknown>;
  responseFormat: 'content';
}

export const PERSIAN_TEXT_MAX_CHARS = 20_000;

export const persianToolDefinitions: Record<PersianTools, PersianToolDefinition> = {
  [PersianTools.calendar]: {
    name: PersianTools.calendar,
    description:
      "Exact dates in the Solar Hijri (شمسی), Gregorian and Islamic (قمری) calendars, and Iran's official holidays. Use it for today's date, any conversion, weekdays, adding days or months, the gap between two dates, a month view, or holidays; never work out dates yourself. Islamic dates are calculated and can differ by a day from Iran's official lunar date; say so when the exact lunar day matters.",
    schema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['today', 'convert', 'add', 'difference', 'month', 'holidays'],
          description:
            'today: today in all calendars. convert: `date` in all calendars. add: `date` moved by `days` and/or `months`. difference: days and working days from `date` to `other_date`. month: every day of a Solar Hijri month. holidays: official holidays of a Solar Hijri year or month.',
        },
        date: {
          type: 'string',
          description: 'YYYY-MM-DD in `calendar`, Latin or Persian digits, e.g. 1405-08-08.',
        },
        calendar: {
          type: 'string',
          enum: ['solar_hijri', 'gregorian', 'islamic'],
          description: 'Calendar of `date` and `other_date`. Defaults to solar_hijri.',
        },
        other_date: {
          type: 'string',
          description: 'The second date for `difference`, in the same calendar.',
        },
        days: { type: 'integer', description: 'Days to add for `add`; negative goes back.' },
        months: {
          type: 'integer',
          description: 'Solar Hijri months to add for `add`; negative goes back.',
        },
        year: {
          type: 'integer',
          description: 'Solar Hijri year for `month` and `holidays`; defaults to this year.',
        },
        month: {
          type: 'integer',
          minimum: 1,
          maximum: 12,
          description:
            'Solar Hijri month for `month` and `holidays`; `holidays` without it lists the whole year.',
        },
      },
      required: ['operation'],
    },
    responseFormat: 'content',
  },
  [PersianTools.normalize]: {
    name: PersianTools.normalize,
    description:
      'Fixes Persian spelling mechanics exactly: Arabic ي/ك to Persian ی/ک, the half-space (نیم‌فاصله) in می/نمی and ها/ترین, spacing around punctuation, the Persian comma, semicolon and question mark, and «quotes». Code, links, emails, @mentions and #hashtags stay as written, and no word or meaning changes. Run it on Persian text you proofread or write before returning it, then make any style edits yourself.',
    schema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          maxLength: PERSIAN_TEXT_MAX_CHARS,
          description: 'The Persian text to fix.',
        },
        digits: {
          type: 'string',
          enum: ['keep', 'persian', 'latin'],
          description:
            'keep (default): leave Latin digits, turn Arabic ones Persian. persian: all digits Persian. latin: all digits Latin.',
        },
      },
      required: ['text'],
    },
    responseFormat: 'content',
  },
};
