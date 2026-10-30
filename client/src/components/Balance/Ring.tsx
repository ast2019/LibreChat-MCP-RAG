import type { ReactNode } from 'react';
import type { BalanceTone } from '~/utils';
import { cn } from '~/utils';

const SIZE = 32;
const STROKE_WIDTH = 2;
const RADIUS = (SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const TONE_CLASS: Record<BalanceTone, string> = {
  normal: 'stroke-text-secondary',
  warning: 'stroke-status-warning',
  danger: 'stroke-status-error',
};

/**
 * A ring around the user's avatar showing what is left of their pack: full right after a
 * purchase, empty once it is spent. Decorative; the caller describes it in words.
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
  const clamped = Math.min(Math.max(percent, 0), 100);
  const offset = CIRCUMFERENCE - (clamped / 100) * CIRCUMFERENCE;
  return (
    <span
      className="relative flex size-8 shrink-0 items-center justify-center"
      data-testid="pack-ring"
    >
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="pointer-events-none absolute inset-0 size-8 -rotate-90"
        aria-hidden="true"
        focusable="false"
      >
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="transparent"
          strokeWidth={STROKE_WIDTH}
          className="stroke-border-medium"
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="transparent"
          strokeWidth={STROKE_WIDTH}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          strokeLinecap="round"
          data-testid="pack-ring-progress"
          className={cn(
            'transition-all duration-300 motion-reduce:transition-none',
            TONE_CLASS[tone],
          )}
        />
      </svg>
      {children}
    </span>
  );
}
