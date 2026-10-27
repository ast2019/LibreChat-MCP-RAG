import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { useRecoilValue } from 'recoil';
import type { WeekStartDay } from '~/utils/clock';
import { resolveWeekStartsOn, systemLocale, weekStartLocale } from '~/utils/clock';
import { weekStartAtom } from '~/store/weekStart';
import store from '~/store';

/** Resolves the "Week starts on" setting to a concrete day index (0 = Sunday,
 *  1 = Monday, 6 = Saturday). Its 'system' branch follows the APP UI language
 *  (`store.lang`), so a Persian UI starts the week on Saturday; the RUNTIME locale
 *  is used when the app has no language, or when it names the same language and so
 *  adds the region the picker drops (`en-GB` would otherwise read as `en-US`). */
export default function useWeekStart(): WeekStartDay {
  const preference = useAtomValue(weekStartAtom);
  const appLanguage = useRecoilValue(store.lang);
  return useMemo(
    () => resolveWeekStartsOn(preference, weekStartLocale(appLanguage, systemLocale())),
    [preference, appLanguage],
  );
}
