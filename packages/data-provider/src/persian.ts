import { z } from 'zod';

/** Deterministic Persian helpers the chat model calls instead of guessing dates or spelling. */
export enum PersianTools {
  calendar = 'persian_calendar',
  normalize = 'persian_normalize',
}

export const PERSIAN_TOOL_NAMES: readonly string[] = Object.values(PersianTools);

/** Deployment skills that declare each tool; a tool follows its skills' scope on saved agents. */
export const PERSIAN_TOOL_SKILLS: Readonly<Record<PersianTools, readonly string[]>> = {
  [PersianTools.calendar]: ['persian-calendar'],
  [PersianTools.normalize]: ['persian-orthography', 'natural-persian-content'],
};

/** One official holiday whose date moves each year (the lunar ones), as published. */
export const persianHolidaySchema = z.object({
  /** Solar Hijri date with Latin digits, e.g. `1405-01-01` */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().min(1).max(200),
});

export const persianToolsSchema = z.object({
  /** Offer the tools in ordinary chats. Saved agents get them through their Persian skills. */
  chat: z.boolean().default(true),
  /** Time zone for "today" */
  timezone: z.string().min(1).default('Asia/Tehran'),
  /**
   * Official holidays that move every year. The fixed Solar Hijri holidays are built in; the
   * lunar ones depend on the moon sighting, so they come only from this list.
   */
  holidays: z.array(persianHolidaySchema).max(500).default([]),
});

export type TPersianToolsConfig = z.infer<typeof persianToolsSchema>;
export type TPersianHoliday = z.infer<typeof persianHolidaySchema>;
