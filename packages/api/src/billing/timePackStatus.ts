import type { TimeSeatStatus, TimePackRuntimeInput } from './timeSeats';
import type { TimePackRatePool } from './timeRate';
import { getTimePackRatePool } from './timeRate';
import { getTimeSeatPool } from './timeSeats';

/**
 * The plan's live capacity, for the holder's own view of it and for the operator's alerts.
 *
 * Two numbers matter and neither is visible to the user from the client: how much of the shared
 * seat pool is in use, and how much of the shared request rate the key has spent this minute.
 * The gateway's ceiling belongs to the key, so the operator has to see the global counter
 * before it reaches the ceiling — by then the gateway has already refused traffic.
 */

export type TimePackStatus = {
  /** Generations holding a shared seat right now. */
  activeSeats: number;
  /** The pool's seat ceiling. */
  maxSeats: number;
  /** How many of the ceiling the plan's holders occupy. */
  holders: number;
  /** Requests taken from the shared allowance in the current minute. */
  globalRequests: number;
  /** The gateway's ceiling for the whole key. */
  requestsPerMinute: number;
  /** The requester's own requests in the current minute. */
  userRequests: number;
  /** The requester's own share of the allowance. */
  userSharePerMinute: number;
  /** How long until the current minute's allowance is refreshed, in milliseconds. */
  windowResetsInMs: number;
};

const WINDOW_MS = 60_000;

/**
 * Reads the plan's live capacity.
 *
 * A pool that cannot be read reports zeroes rather than failing the request: the status is
 * information for the user, not an access decision, and a Redis hiccup must not turn a
 * working chat into an error.
 */
export async function readTimePackStatus({
  userId,
  runtime,
  seatPool = getTimeSeatPool(),
  ratePool = getTimePackRatePool(),
}: {
  userId: string;
  runtime?: TimePackRuntimeInput;
  seatPool?: { readStatus: (runtime: TimePackRuntimeInput) => Promise<TimeSeatStatus> };
  ratePool?: TimePackRatePool;
}): Promise<TimePackStatus> {
  const resolved = runtime ?? {};
  const [seats, rate] = await Promise.all([
    seatPool.readStatus(resolved).catch(() => null),
    ratePool.read(userId).catch(() => null),
  ]);
  const requestsPerMinute = resolved.requestsPerMinute ?? 60;
  const userSharePerMinute = resolved.userSharePerMinute ?? 20;
  const now = ratePool.now();
  const windowResetsInMs = Math.max(0, (Math.floor(now / WINDOW_MS) + 1) * WINDOW_MS - now);
  return {
    activeSeats: seats?.activeSeats ?? 0,
    maxSeats: seats?.maxSeats ?? resolved.maxSeats ?? 0,
    holders: seats?.holders ?? 0,
    globalRequests: rate?.globalCount ?? 0,
    requestsPerMinute,
    userRequests: rate?.userCount ?? 0,
    userSharePerMinute,
    windowResetsInMs,
  };
}
