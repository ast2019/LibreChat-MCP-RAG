import React from 'react';
import { evolvePath } from '@remotion/paths';
import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { ChartScene, StatScene } from '../types';
import type { SceneProps } from './frame';
import { formatNumber, localizeDigits, useStudio } from '../layout';
import { IconTile, useEnter } from '../ui';
import { SceneFrame, Drift } from './frame';
import { TextBlock } from '../text';
import { alpha } from '../themes';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** Big number with an animated counter; a percentage also draws a progress ring. */
export const Stat: React.FC<SceneProps<StatScene>> = ({ scene, frames }) => {
  const { box, u, theme, fonts, lang } = useStudio();
  const frame = useCurrentFrame();
  const countFrames = Math.min(50, Math.max(20, Math.round(frames * 0.45)));
  const p = interpolate(frame, [6, 6 + countFrames], [0, 1], { ...clamp, easing: Easing.out(Easing.exp) });
  const shown = formatNumber(scene.value * p, scene.decimals, lang);
  const percent = /%|٪|درصد/.test(scene.suffix ?? '') && scene.value >= 0 && scene.value <= 100;
  const ringSize = Math.min(box.width * 0.8, box.height * 0.48);
  const numberSize = percent ? ringSize * 0.24 : Math.min(u * 26, box.width / Math.max(3, shown.length * 0.62));
  const pop = useEnter(4, { damping: 12 });
  const numberBlock = (
    <div
      dir="ltr"
      style={{
        fontFamily: fonts.heading,
        fontWeight: 900,
        fontSize: numberSize,
        lineHeight: 1,
        color: theme.text,
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'center',
        gap: numberSize * 0.06,
        transform: `scale(${0.85 + 0.15 * pop})`,
        whiteSpace: 'nowrap',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {scene.prefix ? <span style={{ fontSize: numberSize * 0.5, color: theme.accent }}>{localizeDigits(scene.prefix, lang)}</span> : null}
      <span>{shown}</span>
      {scene.suffix ? <span style={{ fontSize: numberSize * 0.42, color: theme.accent }}>{localizeDigits(scene.suffix, lang)}</span> : null}
    </div>
  );
  const r = ringSize / 2 - u * 2;
  const circumference = 2 * Math.PI * r;
  return (
    <Drift frames={frames}>
      <SceneFrame gap={u * 3} style={{ alignItems: 'center' }}>
        {scene.icon && !percent ? <IconTile name={scene.icon} size={u * 13} delay={0} /> : null}
        {percent ? (
          <div style={{ position: 'relative', width: ringSize, height: ringSize }}>
            <svg width={ringSize} height={ringSize} style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}>
              <circle cx={ringSize / 2} cy={ringSize / 2} r={r} stroke={alpha(theme.text, 0.1)} strokeWidth={u * 2.4} fill="none" />
              <circle
                cx={ringSize / 2}
                cy={ringSize / 2}
                r={r}
                stroke={theme.accent}
                strokeWidth={u * 2.4}
                strokeLinecap="round"
                fill="none"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - (scene.value / 100) * p)}
              />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{numberBlock}</div>
          </div>
        ) : (
          numberBlock
        )}
        <TextBlock text={scene.label} heading weight={800} align="center" width={box.width} height={box.height * 0.2} maxLines={3} maxSize={u * 7} delay={16} where={`${scene.id}.label`} />
        {scene.caption ? (
          <TextBlock text={scene.caption} align="center" width={box.width} height={box.height * 0.16} maxLines={3} maxSize={u * 4.4} color={theme.muted} delay={26} where={`${scene.id}.caption`} />
        ) : null}
      </SceneFrame>
    </Drift>
  );
};

/** Chart drawn from the storyboard's data points. */
export const Chart: React.FC<SceneProps<ChartScene>> = ({ scene, frames }) => {
  const { box, u, theme } = useStudio();
  const titleH = scene.title ? box.height * 0.18 : 0;
  const captionH = scene.caption ? box.height * 0.12 : 0;
  const plot = { width: box.width, height: box.height - titleH - captionH - u * 6 };
  return (
    <Drift frames={frames}>
      <SceneFrame gap={u * 3}>
        {scene.title ? (
          <TextBlock text={scene.title} heading width={box.width} height={titleH} maxLines={2} maxSize={u * 7.5} reveal="words" where={`${scene.id}.title`} />
        ) : null}
        <div style={{ width: plot.width, height: plot.height, position: 'relative' }}>
          {scene.chart === 'line' ? (
            <LineChart scene={scene} width={plot.width} height={plot.height} />
          ) : scene.chart === 'pie' || scene.chart === 'donut' ? (
            <PieChart scene={scene} width={plot.width} height={plot.height} />
          ) : (
            <BarChart scene={scene} width={plot.width} height={plot.height} />
          )}
        </div>
        {scene.caption ? (
          <TextBlock text={scene.caption} width={box.width} height={captionH} maxLines={2} maxSize={u * 4} color={theme.muted} delay={40} where={`${scene.id}.caption`} />
        ) : null}
      </SceneFrame>
    </Drift>
  );
};

interface ChartProps {
  scene: ChartScene;
  width: number;
  height: number;
}

const valueText = (value: number, scene: ChartScene, lang: 'fa' | 'en') => {
  const max = Math.max(...scene.data.map((d) => Math.abs(d.value)));
  const fractional = scene.data.some((d) => !Number.isInteger(d.value));
  const decimals = !fractional ? 0 : Math.abs(value) < 1 ? 2 : max < 100 ? 1 : 0;
  return `${formatNumber(value, decimals, lang)}${scene.unit ? ` ${localizeDigits(scene.unit, lang)}` : ''}`;
};

const BarChart: React.FC<ChartProps> = ({ scene, width, height }) => {
  const { u, theme, lang, rtl, fonts, landscape } = useStudio();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const max = Math.max(...scene.data.map((d) => Math.abs(d.value)), 1e-9);
  const colorOf = (i: number) =>
    scene.highlight == null ? theme.palette[i % theme.palette.length] : i === scene.highlight ? theme.accent : alpha(theme.muted, 0.55);

  if (landscape) {
    const n = scene.data.length;
    const slot = width / n;
    const barW = Math.min(slot * 0.56, u * 16);
    const labelH = u * 9;
    const valueH = u * 7;
    const plotH = height - labelH - valueH;
    return (
      <div dir={rtl ? 'rtl' : 'ltr'} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: labelH, height: 2, background: alpha(theme.text, 0.2) }} />
        {scene.data.map((d, i) => {
          const g = spring({ frame: frame - 10 - i * 5, fps, config: { damping: 15, mass: 0.8 } });
          const h = (Math.abs(d.value) / max) * plotH * g;
          return (
            <div key={i} style={{ width: slot, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
              <div dir={rtl ? 'rtl' : 'ltr'} style={{ fontFamily: fonts.body, fontWeight: 800, fontSize: u * 3.8, color: theme.text, opacity: g, height: valueH, display: 'flex', alignItems: 'flex-end', paddingBottom: u, whiteSpace: 'nowrap' }}>
                {valueText(d.value * g, scene, lang)}
              </div>
              <div style={{ width: barW, height: h, borderRadius: `${u * 1.4}px ${u * 1.4}px 0 0`, background: `linear-gradient(180deg, ${colorOf(i)}, ${alpha(colorOf(i), 0.55)})` }} />
              <div style={{ height: labelH, paddingTop: u * 1.5, width: slot }}>
                <TextBlock text={d.label} align="center" width={slot - u} height={labelH - u * 1.5} maxLines={2} maxSize={u * 3.6} color={theme.muted} reveal="none" where={`${scene.id}.data[${i}].label`} />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const rowH = Math.min(u * 15, height / scene.data.length);
  const labelW = width * 0.28;
  const valueW = width * 0.26;
  const trackW = width - labelW - valueW - u * 4;
  return (
    <div dir={rtl ? 'rtl' : 'ltr'} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      {scene.data.map((d, i) => {
        const g = spring({ frame: frame - 10 - i * 5, fps, config: { damping: 15, mass: 0.8 } });
        return (
          <div key={i} style={{ height: rowH, display: 'flex', alignItems: 'center', gap: u * 2 }}>
            <div style={{ width: labelW }}>
              <TextBlock text={d.label} width={labelW} height={rowH * 0.9} maxLines={2} maxSize={u * 4.2} weight={600} reveal="none" where={`${scene.id}.data[${i}].label`} />
            </div>
            <div style={{ width: trackW, height: rowH * 0.46, borderRadius: 999, background: alpha(theme.text, 0.07), overflow: 'hidden' }}>
              <div
                style={{
                  width: `${(Math.abs(d.value) / max) * 100 * g}%`,
                  height: '100%',
                  borderRadius: 999,
                  background: `linear-gradient(${rtl ? 270 : 90}deg, ${alpha(colorOf(i), 0.7)}, ${colorOf(i)})`,
                }}
              />
            </div>
            <div dir={rtl ? 'rtl' : 'ltr'} style={{ width: valueW, fontFamily: fonts.body, fontWeight: 800, fontSize: u * 3.8, color: theme.text, textAlign: 'end', whiteSpace: 'nowrap', opacity: Math.min(1, g * 1.5) }}>
              {valueText(d.value * g, scene, lang)}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const LineChart: React.FC<ChartProps> = ({ scene, width, height }) => {
  const { u, theme, lang, fonts } = useStudio();
  const frame = useCurrentFrame();
  const values = scene.data.map((d) => d.value);
  const min = Math.min(0, ...values);
  const max = Math.max(...values, min + 1e-9);
  const labelH = u * 9;
  const padTop = u * 8;
  const padX = u * 6;
  const plotH = height - labelH - padTop;
  const step = (width - padX * 2) / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => ({ x: padX + i * step, y: padTop + plotH - ((v - min) / (max - min)) * plotH }));
  const d = pts.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const area = `${d} L ${pts[pts.length - 1].x.toFixed(1)} ${padTop + plotH} L ${pts[0].x.toFixed(1)} ${padTop + plotH} Z`;
  const draw = interpolate(frame, [8, 8 + Math.min(60, 12 * values.length)], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const evolved = evolvePath(draw, d);
  const gid = `area-${scene.id}`;
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <svg width={width} height={height}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={theme.accent} stopOpacity={0.35} />
            <stop offset="100%" stopColor={theme.accent} stopOpacity={0} />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <line key={g} x1={padX} x2={width - padX} y1={padTop + plotH * g} y2={padTop + plotH * g} stroke={alpha(theme.text, 0.08)} strokeWidth={1} />
        ))}
        <path d={area} fill={`url(#${gid})`} opacity={draw} />
        <path d={d} fill="none" stroke={theme.accent} strokeWidth={u * 0.9} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={evolved.strokeDasharray} strokeDashoffset={evolved.strokeDashoffset} />
        {pts.map((p, i) => {
          const reached = draw * (values.length - 1) >= i - 0.01;
          const s = reached ? 1 : 0;
          const hot = scene.highlight === i;
          return <circle key={i} cx={p.x} cy={p.y} r={u * (hot ? 2 : 1.3) * s} fill={hot ? theme.accent2 : theme.accent} stroke={theme.base[0]} strokeWidth={u * 0.5} />;
        })}
      </svg>
      {pts.map((p, i) => {
        const reached = draw * (values.length - 1) >= i - 0.01;
        return (
          <React.Fragment key={i}>
            <div dir={lang === 'fa' ? 'rtl' : 'ltr'} style={{ position: 'absolute', left: p.x - step / 2, width: step, top: p.y - u * 7, textAlign: 'center', fontFamily: fonts.body, fontWeight: 800, fontSize: u * 3.4, color: theme.text, opacity: reached ? 1 : 0, whiteSpace: 'nowrap' }}>
              {valueText(values[i], scene, lang)}
            </div>
            <div style={{ position: 'absolute', left: p.x - step / 2, width: step, top: height - labelH + u * 1.5 }}>
              <TextBlock text={scene.data[i].label} align="center" width={step} height={labelH - u * 1.5} maxLines={2} maxSize={u * 3.4} color={theme.muted} reveal="none" where={`${scene.id}.data[${i}].label`} />
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
};

const PieChart: React.FC<ChartProps> = ({ scene, width, height }) => {
  const { u, theme, lang, landscape, fonts } = useStudio();
  const frame = useCurrentFrame();
  const total = scene.data.reduce((s, d) => s + d.value, 0) || 1;
  const sweep = interpolate(frame, [8, 50], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const size = landscape ? Math.min(height, width * 0.48) : Math.min(width * 0.78, height * 0.55);
  const donut = scene.chart === 'donut';
  const r = donut ? size * 0.36 : size * 0.25;
  const stroke = donut ? size * 0.16 : size * 0.5;
  const c = 2 * Math.PI * r;
  let acc = 0;
  const slices = scene.data.map((d, i) => {
    const start = acc / total;
    acc += d.value;
    const end = acc / total;
    const shown = Math.max(0, Math.min(end, sweep) - start);
    const color = scene.highlight == null || scene.highlight === i ? theme.palette[i % theme.palette.length] : alpha(theme.palette[i % theme.palette.length], 0.45);
    return { start, shown, color, pct: d.value / total };
  });
  const focus = scene.highlight ?? slices.reduce((best, s, i) => (s.pct > slices[best].pct ? i : best), 0);
  const legendW = landscape ? width - size - u * 6 : width;
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: landscape ? 'row' : 'column', alignItems: 'center', justifyContent: 'center', gap: u * 4 }}>
      <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          {slices.map((s, i) => (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={stroke} strokeDasharray={`${s.shown * c} ${c}`} strokeDashoffset={-s.start * c} />
          ))}
        </svg>
        {donut ? (
          <div dir="ltr" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fonts.heading, fontWeight: 900, fontSize: size * 0.16, color: theme.text, opacity: sweep }}>
            {formatNumber(slices[focus].pct * 100 * sweep, 0, lang)}
            {lang === 'fa' ? '٪' : '%'}
          </div>
        ) : null}
      </div>
      <div style={{ width: legendW, display: 'flex', flexDirection: 'column', gap: u * 1.2 }}>
        {scene.data.map((d, i) => (
          <Legend key={i} delay={20 + i * 5} color={slices[i].color} label={d.label} value={`${formatNumber(slices[i].pct * 100, 0, lang)}${lang === 'fa' ? '٪' : '%'}`} width={legendW} where={`${scene.id}.data[${i}].label`} />
        ))}
      </div>
    </div>
  );
};

const Legend: React.FC<{ delay: number; color: string; label: string; value: string; width: number; where: string }> = ({ delay, color, label, value, width, where }) => {
  const { u, theme, fonts } = useStudio();
  const p = useEnter(delay, { damping: 18 });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: u * 2, opacity: p, transform: `translateY(${(1 - p) * u * 2}px)` }}>
      <div style={{ width: u * 3, height: u * 3, borderRadius: u, background: color, flexShrink: 0 }} />
      <TextBlock text={label} width={width - u * 20} height={u * 6} maxLines={1} maxSize={u * 4} weight={600} reveal="none" where={where} />
      <div dir="ltr" style={{ marginInlineStart: 'auto', fontFamily: fonts.body, fontWeight: 800, fontSize: u * 4, color: theme.text }}>{value}</div>
    </div>
  );
};
