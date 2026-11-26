import type { ReactNode } from 'react';

/**
 * A flame halo around the user's avatar while the Claude time plan is active.
 *
 * The ring that shows the remaining credit says how much is left; this says that the plan is
 * running at all, so a user can tell at a glance that their Claude calls are on the shared
 * time pool rather than on their credit. The paint lives in CSS (`.time-pack-flame-glow`), because
 * an animated conic gradient cannot be expressed with utilities.
 *
 * The glow sits outside the child (`-inset-1`) and under it (`z-0`), so a PackRing or Avatar on
 * top does not cover the fire.
 */
export default function TimePackFlame({ children }: { children: ReactNode }) {
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center">
      <span
        aria-hidden="true"
        data-testid="time-pack-flame"
        className="time-pack-flame-glow pointer-events-none absolute -inset-1 z-0 rounded-full"
      />
      <span className="relative z-[1] flex">{children}</span>
    </span>
  );
}
