import { useMemo } from 'react';
import { Progress } from '@librechat/client';
import { useTranslation } from 'react-i18next';
import type { TTimePackStatusResponse } from 'librechat-data-provider';
import useLocalize from '~/hooks/useLocalize';
import cn from '~/utils/cn';

interface TimePackStatusProps {
  status: TTimePackStatusResponse | undefined;
  className?: string;
}

/**
 * The plan's live capacity, for the holder's own view of it.
 *
 * Two things matter and neither is visible from the client: how much of the shared seat pool
 * is in use, and how much of the shared request rate the key has spent this minute. The
 * gateway's ceiling belongs to the key, so the holder has to see the global counter before it
 * reaches the ceiling — by then the gateway has already refused traffic.
 */
export default function TimePackStatus({ status, className }: TimePackStatusProps) {
  const localize = useLocalize();
  const { i18n } = useTranslation();

  const view = useMemo(() => {
    if (status == null || status.active !== true) {
      return null;
    }
    const maxSeats = status.maxSeats ?? 0;
    const activeSeats = status.activeSeats ?? 0;
    const requestsPerMinute = status.requestsPerMinute ?? 0;
    const globalRequests = status.globalRequests ?? 0;
    const userSharePerMinute = status.userSharePerMinute ?? 0;
    const userRequests = status.userRequests ?? 0;
    return {
      maxSeats,
      activeSeats,
      seatsPercent: maxSeats > 0 ? Math.min(100, Math.round((activeSeats / maxSeats) * 100)) : 0,
      requestsPerMinute,
      globalRequests,
      ratePercent:
        requestsPerMinute > 0
          ? Math.min(100, Math.round((globalRequests / requestsPerMinute) * 100))
          : 0,
      userSharePerMinute,
      userRequests,
      userPercent:
        userSharePerMinute > 0
          ? Math.min(100, Math.round((userRequests / userSharePerMinute) * 100))
          : 0,
      locale: i18n.resolvedLanguage,
    };
  }, [status, i18n.resolvedLanguage]);

  if (view == null) {
    return null;
  }

  const seatTone = view.seatsPercent >= 90 ? 'error' : 'default';
  const rateTone = view.ratePercent >= 90 ? 'error' : 'default';

  return (
    <section
      aria-label={localize('com_ui_balance_time_pack_capacity')}
      data-testid="time-pack-status"
      className={cn('flex flex-col gap-y-2', className)}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1">
        <span className="text-text-secondary text-xs">
          {localize('com_ui_balance_time_pack_seats', {
            0: String(view.activeSeats),
            1: String(view.maxSeats),
          })}
        </span>
        <span
          className="text-text-secondary justify-self-end text-xs whitespace-nowrap"
          data-testid="time-pack-seats"
        >
          {localize('com_ui_balance_time_pack_holders', { 0: String(status?.holders ?? 0) })}
        </span>
      </div>
      <Progress
        value={view.seatsPercent}
        aria-label={localize('com_ui_balance_time_pack_capacity')}
        variant={seatTone}
        className="w-full"
      />

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1">
        <span className="text-text-secondary text-xs">
          {localize('com_ui_balance_time_pack_rate', {
            0: String(view.globalRequests),
            1: String(view.requestsPerMinute),
          })}
        </span>
        <span
          className="text-text-secondary justify-self-end text-xs whitespace-nowrap"
          data-testid="time-pack-rate"
        >
          {localize('com_ui_balance_time_pack_rate_mine', {
            0: String(view.userRequests),
            1: String(view.userSharePerMinute),
          })}
        </span>
      </div>
      <Progress
        value={view.ratePercent}
        aria-label={localize('com_ui_balance_time_pack_rate_label')}
        variant={rateTone}
        className="w-full"
      />
    </section>
  );
}
