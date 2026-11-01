import type { CSSProperties, ReactNode } from 'react';
import type { BalanceTone } from '~/utils';

const STROKE = 2;
const SIZE = 32;
const RADIUS = (SIZE - STROKE) / 2;

const TONE_TOKEN: Record<BalanceTone, '--status-success' | '--status-warning' | '--status-error'> =
  {
    /** A full or partly spent pack is green. Gray is only the empty track. */
    normal: '--status-success',
    warning: '--status-warning',
    danger: '--status-error',
  };

/**
 * A ring around the user's avatar showing what is left of their pack: green while
 * credit remains, amber once it is nearly spent, and gone once it is empty. The
 * gray circle underneath is only the unspent track. `.pack-ring-arc` paints the
 * sweep from a darker shade of that tone at 12 o'clock to a lighter one at the
 * tip, so the point where the allowance runs out stays visible. Decorative; the
 * caller describes it in words.
 */
export default function PackRing({
  percent,
  tone,
  children,
}: {
  /** 0–100, the share of the pack still left */
  percent: number;
  tone: BalanceTone;
  children: ReactNode;
}) {
  const clamped = Math.min(Math.max(Math.round(percent), 0), 100);
  const degrees = Math.round(clamped * 36) / 10;
  const tip = degrees >= 360 ? 359.2 : degrees;

  return (
    <span
      className="relative flex size-8 shrink-0 items-center justify-center"
      data-testid="pack-ring"
    >
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="pointer-events-none absolute inset-0 size-8"
        aria-hidden="true"
        focusable="false"
      >
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="transparent"
          strokeWidth={STROKE}
          className="stroke-border-medium"
        />
      </svg>
      <span
        aria-hidden="true"
        data-testid="pack-ring-progress"
        data-percent={clamped}
        data-tone={tone}
        className="pack-ring-arc pointer-events-none absolute inset-0 rounded-full transition-all duration-300 motion-reduce:transition-none"
        style={
          {
            '--pack-ring-ink': `var(${TONE_TOKEN[tone]})`,
            '--pack-ring-tip': `${tip}deg`,
            '--pack-ring-end': `${degrees}deg`,
          } as CSSProperties
        }
      />
      {children}
    </span>
  );
}
