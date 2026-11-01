import type { TServerLoadPoint } from 'librechat-data-provider';
import { formatPercent } from '~/components/Admin/Status/format';
import { useLocalize } from '~/hooks';

const WIDTH = 300;
const HEIGHT = 80;

/** One series as polyline points; a missing reading breaks the line rather than reading zero. */
function toSegments(points: TServerLoadPoint[], read: (point: TServerLoadPoint) => number | null) {
  const segments: string[] = [];
  let current: string[] = [];
  const step = points.length > 1 ? WIDTH / (points.length - 1) : WIDTH;
  points.forEach((point, index) => {
    const value = read(point);
    if (value == null) {
      if (current.length > 1) {
        segments.push(current.join(' '));
      }
      current = [];
      return;
    }
    const y = HEIGHT - (Math.min(Math.max(value, 0), 100) / 100) * HEIGHT;
    current.push(`${(index * step).toFixed(1)},${y.toFixed(1)}`);
  });
  if (current.length > 1) {
    segments.push(current.join(' '));
  }
  return segments;
}

/**
 * RAM and CPU over the last 24 hours, one point a minute, on a 0-100% scale with the two
 * refusal thresholds dashed. Drawn left to right in time in both languages, like any chart.
 */
export default function LoadChart({
  history,
  limits,
  locale,
}: {
  history: TServerLoadPoint[];
  limits: { ram: number; cpu: number };
  locale: string;
}) {
  const localize = useLocalize();
  if (history.length < 2) {
    return (
      <p className="text-text-secondary text-sm">{localize('com_admin_server_chart_empty')}</p>
    );
  }
  const last = history[history.length - 1];
  const ram = toSegments(history, (point) => point.ram);
  const cpu = toSegments(history, (point) => point.cpu);
  const lineAt = (percent: number) => HEIGHT - (percent / 100) * HEIGHT;
  const summary = localize('com_admin_server_chart_label', {
    0: last.ram == null ? '—' : formatPercent(last.ram, locale),
    1: last.cpu == null ? '—' : formatPercent(last.cpu, locale),
  });

  return (
    <figure className="space-y-2">
      <div
        dir="ltr"
        role="img"
        aria-label={summary}
        className="border-border-light rounded-lg border p-2"
      >
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          className="h-28 w-full"
          aria-hidden="true"
        >
          <line
            x1="0"
            x2={WIDTH}
            y1={lineAt(limits.ram)}
            y2={lineAt(limits.ram)}
            className="stroke-status-warning-border"
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
          />
          {limits.cpu !== limits.ram && (
            <line
              x1="0"
              x2={WIDTH}
              y1={lineAt(limits.cpu)}
              y2={lineAt(limits.cpu)}
              className="stroke-status-warning-border"
              strokeDasharray="1 3"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {ram.map((points) => (
            <polyline
              key={`ram-${points.slice(0, 12)}`}
              points={points}
              fill="none"
              strokeWidth="2"
              className="stroke-brand-purple"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {cpu.map((points) => (
            <polyline
              key={`cpu-${points.slice(0, 12)}`}
              points={points}
              fill="none"
              strokeWidth="2"
              className="stroke-status-info-border"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </div>
      <figcaption className="text-text-secondary flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span>{localize('com_admin_server_chart')}</span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="bg-brand-purple inline-block h-0.5 w-4 rounded-full"
          />
          RAM
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="bg-status-info-border inline-block h-0.5 w-4 rounded-full"
          />
          CPU
        </span>
        <span>{localize('com_admin_server_chart_limits')}</span>
      </figcaption>
    </figure>
  );
}
