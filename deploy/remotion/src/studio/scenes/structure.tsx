import React from 'react';
import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { CompareScene, IconsScene, StepsScene, TimelineScene, CompareSide } from '../types';
import type { SceneProps } from './frame';
import { Card, Icon, IconTile, useEnter } from '../ui';
import { localizeDigits, useStudio } from '../layout';
import { SceneFrame, Drift } from './frame';
import { TextBlock } from '../text';
import { Row } from './text';
import { alpha } from '../themes';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** Icon grid (cards that pop in) or icon list (rows that slide in). */
export const Icons: React.FC<SceneProps<IconsScene>> = ({ scene, frames }) => {
  const { box, u, theme, landscape } = useStudio();
  const titleH = scene.title ? box.height * 0.2 : 0;
  const n = scene.items.length;
  if (scene.layout === 'list') {
    const rowH = Math.min(u * 17, (box.height - titleH - u * 6) / n);
    return (
      <Drift frames={frames}>
        <SceneFrame gap={u * 4}>
          {scene.title ? <TextBlock text={scene.title} heading width={box.width} height={titleH} maxLines={2} maxSize={u * 8} reveal="words" where={`${scene.id}.title`} /> : null}
          <div style={{ display: 'flex', flexDirection: 'column', gap: u * 1.5 }}>
            {scene.items.map((item, i) => (
              <Row key={i} delay={12 + i * 8}>
                <IconTile name={item.icon} size={Math.min(u * 11, rowH * 0.8)} delay={12 + i * 8} color={theme.palette[i % theme.palette.length]} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: u * 0.5 }}>
                  <TextBlock text={item.label} width={box.width - u * 15} height={rowH * 0.45} maxLines={1} maxSize={u * 5.2} weight={800} reveal="none" where={`${scene.id}.items[${i}].label`} />
                  {item.detail ? <TextBlock text={item.detail} width={box.width - u * 15} height={rowH * 0.5} maxLines={2} maxSize={u * 3.8} color={theme.muted} reveal="none" where={`${scene.id}.items[${i}].detail`} /> : null}
                </div>
              </Row>
            ))}
          </div>
        </SceneFrame>
      </Drift>
    );
  }
  const cols = landscape ? Math.min(n, n === 4 ? 4 : 3) : n <= 3 ? 1 : 2;
  const rows = Math.ceil(n / cols);
  const gap = u * 2.4;
  const cardW = (box.width - gap * (cols - 1)) / cols;
  const cardH = Math.min(cols === 1 ? u * 22 : u * 38, (box.height - titleH - u * 4 - gap * (rows - 1)) / rows);
  const horizontal = cols === 1;
  return (
    <Drift frames={frames}>
      <SceneFrame gap={u * 4}>
        {scene.title ? <TextBlock text={scene.title} heading width={box.width} height={titleH} maxLines={2} maxSize={u * 8} reveal="words" where={`${scene.id}.title`} /> : null}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap }}>
          {scene.items.map((item, i) => (
            <GridCard key={i} delay={10 + i * 6} width={cardW} height={cardH}>
              <div style={{ display: 'flex', flexDirection: horizontal ? 'row' : 'column', alignItems: horizontal ? 'center' : 'flex-start', gap: u * 2, height: '100%' }}>
                <IconTile name={item.icon} size={Math.min(u * 12, cardH * 0.42)} delay={14 + i * 6} color={theme.palette[i % theme.palette.length]} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: u * 0.6 }}>
                  <TextBlock text={item.label} width={horizontal ? cardW - u * 20 : cardW - u * 6} height={cardH * 0.3} maxLines={2} maxSize={u * 5} weight={800} reveal="none" where={`${scene.id}.items[${i}].label`} />
                  {item.detail ? <TextBlock text={item.detail} width={horizontal ? cardW - u * 20 : cardW - u * 6} height={cardH * 0.32} maxLines={3} maxSize={u * 3.5} color={theme.muted} reveal="none" where={`${scene.id}.items[${i}].detail`} /> : null}
                </div>
              </div>
            </GridCard>
          ))}
        </div>
      </SceneFrame>
    </Drift>
  );
};

const GridCard: React.FC<{ children: React.ReactNode; delay: number; width: number; height: number }> = ({ children, delay, width, height }) => {
  const { u } = useStudio();
  const p = useEnter(delay, { damping: 14 });
  return (
    <Card pad={u * 2.6} style={{ width, height, boxSizing: 'border-box', opacity: p, transform: `translateY(${(1 - p) * u * 6}px) scale(${0.92 + 0.08 * p})` }}>
      {children}
    </Card>
  );
};

/** Numbered process: a connector draws from step to step and each step lights up as it lands. */
export const Steps: React.FC<SceneProps<StepsScene>> = ({ scene, frames }) => {
  const { box, u, theme, landscape, fonts, lang } = useStudio();
  const frame = useCurrentFrame();
  const n = scene.steps.length;
  const titleH = scene.title ? box.height * 0.18 : 0;
  const per = Math.max(10, Math.min(24, Math.floor((frames * 0.6) / n)));
  /** Linear so each step lights exactly when the connector reaches it (frame 10 + per * i). */
  const line = interpolate(frame, [10, 10 + per * (n - 1)], [0, 1], clamp);
  const dot = u * 10;
  if (landscape) {
    const slot = box.width / n;
    return (
      <Drift frames={frames}>
        <SceneFrame gap={u * 5}>
          {scene.title ? <TextBlock text={scene.title} heading width={box.width} height={titleH} maxLines={2} maxSize={u * 8} reveal="words" where={`${scene.id}.title`} /> : null}
          <div style={{ position: 'relative', display: 'flex' }}>
            <div style={{ position: 'absolute', top: dot / 2 - 2, insetInlineStart: slot / 2, width: (box.width - slot) * line, height: 4, borderRadius: 2, background: `linear-gradient(90deg, ${theme.accent}, ${theme.accent2})` }} />
            {scene.steps.map((step, i) => (
              <div key={i} style={{ width: slot, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: u * 2, paddingInline: u }}>
                <StepDot at={10 + per * i} size={dot} icon={step.icon} label={localizeDigits(String(i + 1), lang)} font={fonts.heading} />
                <TextBlock text={step.title} align="center" width={slot - u * 2} height={u * 12} maxLines={2} maxSize={u * 4.6} weight={800} delay={10 + per * i} where={`${scene.id}.steps[${i}].title`} />
                {step.detail ? <TextBlock text={step.detail} align="center" width={slot - u * 2} height={u * 16} maxLines={3} maxSize={u * 3.4} color={theme.muted} delay={14 + per * i} where={`${scene.id}.steps[${i}].detail`} /> : null}
              </div>
            ))}
          </div>
        </SceneFrame>
      </Drift>
    );
  }
  const rowH = Math.min(u * 24, (box.height - titleH - u * 6) / n);
  return (
    <Drift frames={frames}>
      <SceneFrame gap={u * 4}>
        {scene.title ? <TextBlock text={scene.title} heading width={box.width} height={titleH} maxLines={2} maxSize={u * 8} reveal="words" where={`${scene.id}.title`} /> : null}
        <div style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', insetInlineStart: dot / 2 - 2, top: dot / 2, width: 4, height: rowH * (n - 1) * line, borderRadius: 2, background: `linear-gradient(180deg, ${theme.accent}, ${theme.accent2})` }} />
          {scene.steps.map((step, i) => (
            <div key={i} style={{ height: rowH, display: 'flex', gap: u * 3 }}>
              <StepDot at={10 + per * i} size={dot} icon={step.icon} label={localizeDigits(String(i + 1), lang)} font={fonts.heading} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: u * 0.6, paddingTop: u * 1.2 }}>
                <TextBlock text={step.title} width={box.width - dot - u * 4} height={rowH * 0.36} maxLines={1} maxSize={u * 5.4} weight={800} delay={10 + per * i} where={`${scene.id}.steps[${i}].title`} />
                {step.detail ? <TextBlock text={step.detail} width={box.width - dot - u * 4} height={rowH * 0.5} maxLines={2} maxSize={u * 3.8} color={theme.muted} delay={14 + per * i} where={`${scene.id}.steps[${i}].detail`} /> : null}
              </div>
            </div>
          ))}
        </div>
      </SceneFrame>
    </Drift>
  );
};

const StepDot: React.FC<{ at: number; size: number; icon?: string; label: string; font: string }> = ({ at, size, icon, label, font }) => {
  const { theme } = useStudio();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const active = frame >= at;
  const p = spring({ frame: frame - at, fps, config: { damping: 10, mass: 0.5 } });
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: active ? theme.accent : theme.surface,
        border: `2px solid ${active ? theme.accent : theme.border}`,
        color: active ? theme.onAccent : theme.muted,
        fontFamily: font,
        fontWeight: 900,
        fontSize: size * 0.42,
        transform: `scale(${0.85 + 0.15 * (active ? p : 0)})`,
        boxShadow: active ? `0 0 ${size * 0.5}px ${alpha(theme.accent, 0.5)}` : 'none',
        position: 'relative',
        zIndex: 1,
      }}
    >
      {icon ? <Icon name={icon} size={size * 0.5} color={active ? theme.onAccent : theme.muted} /> : label}
    </div>
  );
};

/** Timeline: dated events along a line that draws through them. */
export const Timeline: React.FC<SceneProps<TimelineScene>> = ({ scene, frames }) => {
  const { box, u, theme, landscape, fonts, lang } = useStudio();
  const frame = useCurrentFrame();
  const n = scene.events.length;
  const titleH = scene.title ? box.height * 0.18 : 0;
  const per = Math.max(10, Math.min(26, Math.floor((frames * 0.6) / n)));
  const line = interpolate(frame, [8, 8 + per * n], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) });
  const date = (text: string, i: number) => {
    const reached = line * n >= i + 0.2;
    return (
      <div dir="auto" style={{ alignSelf: landscape ? 'center' : 'flex-start', padding: `${u * 0.6}px ${u * 1.8}px`, borderRadius: 999, background: reached ? theme.accent : alpha(theme.text, 0.08), color: reached ? theme.onAccent : theme.muted, fontFamily: fonts.heading, fontWeight: 900, fontSize: u * 3.8, whiteSpace: 'nowrap' }}>
        {localizeDigits(text, lang)}
      </div>
    );
  };
  if (landscape) {
    const slot = box.width / n;
    return (
      <Drift frames={frames}>
        <SceneFrame gap={u * 5}>
          {scene.title ? <TextBlock text={scene.title} heading width={box.width} height={titleH} maxLines={2} maxSize={u * 8} reveal="words" where={`${scene.id}.title`} /> : null}
          <div style={{ position: 'relative', display: 'flex', paddingTop: u * 4 }}>
            <div style={{ position: 'absolute', top: 0, insetInlineStart: 0, height: 4, width: box.width * line, background: `linear-gradient(90deg, ${theme.accent}, ${theme.accent2})`, borderRadius: 2 }} />
            {scene.events.map((event, i) => (
              <div key={i} style={{ width: slot, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: u * 1.6, paddingInline: u }}>
                {date(event.date, i)}
                <TextBlock text={event.title} align="center" width={slot - u * 2} height={u * 12} maxLines={2} maxSize={u * 4.4} weight={800} delay={12 + per * i} where={`${scene.id}.events[${i}].title`} />
                {event.detail ? <TextBlock text={event.detail} align="center" width={slot - u * 2} height={u * 14} maxLines={3} maxSize={u * 3.2} color={theme.muted} delay={16 + per * i} where={`${scene.id}.events[${i}].detail`} /> : null}
              </div>
            ))}
          </div>
        </SceneFrame>
      </Drift>
    );
  }
  const rowH = Math.min(u * 22, (box.height - titleH - u * 4) / n);
  return (
    <Drift frames={frames}>
      <SceneFrame gap={u * 4}>
        {scene.title ? <TextBlock text={scene.title} heading width={box.width} height={titleH} maxLines={2} maxSize={u * 8} reveal="words" where={`${scene.id}.title`} /> : null}
        <div style={{ position: 'relative', paddingInlineStart: u * 6 }}>
          <div style={{ position: 'absolute', insetInlineStart: u * 1.5, top: 0, width: 4, height: rowH * n * line, background: `linear-gradient(180deg, ${theme.accent}, ${theme.accent2})`, borderRadius: 2 }} />
          {scene.events.map((event, i) => (
            <div key={i} style={{ height: rowH, display: 'flex', flexDirection: 'column', gap: u, position: 'relative' }}>
              <div style={{ position: 'absolute', insetInlineStart: -u * 5.6, top: u * 1.2, width: u * 2.8, height: u * 2.8, borderRadius: '50%', background: line * n >= i + 0.2 ? theme.accent : theme.surface, border: `2px solid ${theme.accent}` }} />
              {date(event.date, i)}
              <TextBlock text={event.title} width={box.width - u * 8} height={rowH * 0.3} maxLines={1} maxSize={u * 5} weight={800} delay={12 + per * i} where={`${scene.id}.events[${i}].title`} />
              {event.detail ? <TextBlock text={event.detail} width={box.width - u * 8} height={rowH * 0.36} maxLines={2} maxSize={u * 3.6} color={theme.muted} delay={16 + per * i} where={`${scene.id}.events[${i}].detail`} /> : null}
            </div>
          ))}
        </div>
      </SceneFrame>
    </Drift>
  );
};

/** A versus B: two cards that slide in from opposite sides with a VS badge between them. */
export const Compare: React.FC<SceneProps<CompareScene>> = ({ scene, frames }) => {
  const { box, u, theme, landscape, fonts, lang } = useStudio();
  const titleH = scene.title ? box.height * 0.16 : 0;
  const verdictH = scene.verdict ? box.height * 0.12 : 0;
  const gap = u * 6;
  const sideW = landscape ? (box.width - gap) / 2 : box.width;
  const sideH = landscape ? box.height - titleH - verdictH - u * 8 : (box.height - titleH - verdictH - gap - u * 8) / 2;
  const vs = useEnter(22, { damping: 9 });
  const verdict = useEnter(40);
  return (
    <Drift frames={frames}>
      <SceneFrame gap={u * 3}>
        {scene.title ? <TextBlock text={scene.title} heading width={box.width} height={titleH} maxLines={2} maxSize={u * 7.5} reveal="words" where={`${scene.id}.title`} /> : null}
        <div style={{ position: 'relative', display: 'flex', flexDirection: landscape ? 'row' : 'column', gap }}>
          <Side side={scene.left} width={sideW} height={sideH} delay={6} from={-1} tint={theme.accent2} where={`${scene.id}.left`} />
          <Side side={scene.right} width={sideW} height={sideH} delay={14} from={1} tint={theme.accent} where={`${scene.id}.right`} />
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: u * 15,
              height: u * 15,
              marginLeft: -u * 7.5,
              marginTop: -u * 7.5,
              borderRadius: '50%',
              background: `linear-gradient(145deg, ${theme.accent}, ${theme.accent2})`,
              color: theme.onAccent,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: fonts.heading,
              fontWeight: 900,
              fontSize: lang === 'fa' ? u * 3.2 : u * 4.6,
              transform: `scale(${vs}) rotate(${(1 - vs) * 90}deg)`,
              boxShadow: `0 0 ${u * 6}px ${alpha(theme.accent, 0.5)}`,
            }}
          >
            {lang === 'fa' ? 'در برابر' : 'VS'}
          </div>
        </div>
        {scene.verdict ? (
          <div style={{ opacity: verdict, transform: `translateY(${(1 - verdict) * u * 3}px)` }}>
            <TextBlock text={scene.verdict} heading weight={800} align="center" width={box.width} height={verdictH} maxLines={2} maxSize={u * 5} color={theme.accent} reveal="none" where={`${scene.id}.verdict`} />
          </div>
        ) : null}
      </SceneFrame>
    </Drift>
  );
};

const Side: React.FC<{ side: CompareSide; width: number; height: number; delay: number; from: number; tint: string; where: string }> = ({
  side,
  width,
  height,
  delay,
  from,
  tint,
  where,
}) => {
  const { u, theme, rtl } = useStudio();
  const p = useEnter(delay, { damping: 16 });
  const rowH = Math.min(u * 10, (height - u * 16) / side.points.length);
  return (
    <Card
      style={{
        width,
        height,
        boxSizing: 'border-box',
        borderColor: alpha(tint, 0.5),
        opacity: p,
        transform: `translateX(${(1 - p) * u * 14 * from * (rtl ? -1 : 1)}px)`,
        display: 'flex',
        flexDirection: 'column',
        gap: u * 1.6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: u * 2 }}>
        {side.icon ? <IconTile name={side.icon} size={u * 9} delay={delay + 4} color={tint} /> : null}
        <TextBlock text={side.label} heading width={width - u * 18} height={u * 9} maxLines={1} maxSize={u * 6} color={tint} reveal="none" where={`${where}.label`} />
      </div>
      {side.points.map((point, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: u * 1.6 }}>
          <Icon name="point" size={u * 3.4} color={tint} />
          <TextBlock text={point} width={width - u * 12} height={rowH} maxLines={2} maxSize={u * 4} reveal="fade" delay={delay + 8 + i * 5} where={`${where}.points[${i}]`} style={{ color: theme.text }} />
        </div>
      ))}
    </Card>
  );
};
