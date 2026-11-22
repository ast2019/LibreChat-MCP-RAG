import React from 'react';
import { evolvePath } from '@remotion/paths';
import { Easing, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { CtaScene, HookScene, ListScene, LogoScene, QuoteScene } from '../types';
import type { SceneProps } from './frame';
import { Icon, IconTile, Pill, useEnter } from '../ui';
import { localizeDigits, useStudio } from '../layout';
import { SceneFrame, Drift } from './frame';
import { TextBlock } from '../text';
import { alpha } from '../themes';

/** Kinetic title: words rise in one by one, emphasised words get the accent and a marker. */
export const Hook: React.FC<SceneProps<HookScene>> = ({ scene, frames }) => {
  const { box, u, theme, lang } = useStudio();
  const frame = useCurrentFrame();
  const rule = interpolate(frame, [6, 30], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const words = scene.headline.split(/\s+/).length;
  return (
    <Drift frames={frames}>
      <SceneFrame gap={u * 3.5}>
        {scene.icon ? <IconTile name={scene.icon} size={u * 14} delay={2} /> : null}
        {scene.kicker ? <Pill delay={4}>{localizeDigits(scene.kicker, lang)}</Pill> : null}
        <TextBlock
          text={scene.headline}
          heading
          width={box.width}
          height={box.height * 0.5}
          maxLines={4}
          maxSize={u * 13}
          reveal="words"
          stagger={4}
          delay={8}
          emphasis={scene.emphasis}
          where={`${scene.id}.headline`}
        />
        <div
          style={{
            height: Math.max(4, u * 0.8),
            width: box.width * 0.28 * rule,
            borderRadius: 99,
            background: `linear-gradient(90deg, ${theme.accent}, ${theme.accent2})`,
          }}
        />
        {scene.subline ? (
          <TextBlock
            text={scene.subline}
            width={box.width}
            height={box.height * 0.25}
            maxLines={4}
            maxSize={u * 5.2}
            color={theme.muted}
            delay={12 + words * 4}
            where={`${scene.id}.subline`}
          />
        ) : null}
      </SceneFrame>
    </Drift>
  );
};

/** Pull quote with a drawn quotation mark. */
export const Quote: React.FC<SceneProps<QuoteScene>> = ({ scene, frames }) => {
  const { box, u, theme } = useStudio();
  const frame = useCurrentFrame();
  const mark = 'M10 11h-4a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1h3a1 1 0 0 1 1 1v6c0 2.667 -1.333 4.333 -4 5 M19 11h-4a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1h3a1 1 0 0 1 1 1v6c0 2.667 -1.333 4.333 -4 5';
  const draw = interpolate(frame, [0, 30], [0, 1], { extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });
  const evolved = evolvePath(draw, mark);
  const author = useEnter(30);
  return (
    <Drift frames={frames}>
      <SceneFrame gap={u * 3}>
        <svg width={u * 18} height={u * 18} viewBox="0 0 24 24" fill="none">
          <path d={mark} stroke={theme.accent} strokeWidth={1.6} strokeLinecap="round" strokeDasharray={evolved.strokeDasharray} strokeDashoffset={evolved.strokeDashoffset} />
        </svg>
        <TextBlock
          text={scene.quote}
          heading
          weight={700}
          width={box.width}
          height={box.height * 0.55}
          maxLines={7}
          maxSize={u * 8}
          reveal="words"
          stagger={2}
          delay={10}
          where={`${scene.id}.quote`}
        />
        {scene.author ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: u * 2, opacity: author, transform: `translateY(${(1 - author) * u * 3}px)` }}>
            <div style={{ width: u * 6, height: 3, background: theme.accent, borderRadius: 2 }} />
            <div>
              <TextBlock text={scene.author} width={box.width * 0.8} height={u * 7} maxLines={1} maxSize={u * 4.6} weight={700} reveal="none" where={`${scene.id}.author`} />
              {scene.role ? (
                <TextBlock text={scene.role} width={box.width * 0.8} height={u * 6} maxLines={1} maxSize={u * 3.6} color={theme.muted} reveal="none" where={`${scene.id}.role`} />
              ) : null}
            </div>
          </div>
        ) : null}
      </SceneFrame>
    </Drift>
  );
};

/** Title plus bullets that slide in one after another with an icon marker. */
export const List: React.FC<SceneProps<ListScene>> = ({ scene, frames }) => {
  const { box, u, theme } = useStudio();
  const rowHeight = Math.min(u * 16, (box.height * 0.68) / scene.bullets.length);
  return (
    <Drift frames={frames}>
      <SceneFrame gap={u * 4}>
        <TextBlock text={scene.title} heading width={box.width} height={box.height * 0.24} maxLines={3} maxSize={u * 9} reveal="words" where={`${scene.id}.title`} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: u * 2 }}>
          {scene.bullets.map((bullet, i) => (
            <Row key={i} delay={14 + i * 9}>
              <IconTile name={scene.icon ?? 'check'} size={u * 8} delay={14 + i * 9} />
              <TextBlock
                text={bullet}
                width={box.width - u * 12}
                height={rowHeight}
                maxLines={3}
                maxSize={u * 5}
                weight={600}
                reveal="none"
                where={`${scene.id}.bullets[${i}]`}
                style={{ color: theme.text }}
              />
            </Row>
          ))}
        </div>
      </SceneFrame>
    </Drift>
  );
};

export const Row: React.FC<{ children: React.ReactNode; delay: number }> = ({ children, delay }) => {
  const { u, rtl } = useStudio();
  const p = useEnter(delay, { damping: 18 });
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: u * 3,
        opacity: p,
        transform: `translateX(${(1 - p) * u * 10 * (rtl ? 1 : -1)}px)`,
      }}
    >
      {children}
    </div>
  );
};

/** Outro: headline, a call-to-action button with a shimmer, and the link or handle. */
export const Cta: React.FC<SceneProps<CtaScene>> = ({ scene }) => {
  const { box, u, theme, fonts, lang } = useStudio();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const button = spring({ frame: frame - 18, fps, config: { damping: 10, mass: 0.6 } });
  const shimmer = interpolate((frame - 30) % 60, [0, 40], [-30, 130], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const pulse = 1 + Math.sin(frame / 8) * 0.015;
  const link = useEnter(30);
  return (
    <SceneFrame gap={u * 5} style={{ alignItems: 'center' }}>
      <TextBlock text={scene.headline} heading align="center" width={box.width} height={box.height * 0.42} maxLines={4} maxSize={u * 11} reveal="words" emphasis={[]} where={`${scene.id}.headline`} />
      {scene.action ? (
        <div
          style={{
            position: 'relative',
            overflow: 'hidden',
            padding: `${u * 2.6}px ${u * 6}px`,
            borderRadius: 999,
            background: `linear-gradient(90deg, ${theme.accent}, ${theme.accent2})`,
            color: theme.onAccent,
            fontFamily: fonts.heading,
            fontWeight: 800,
            fontSize: u * 5,
            display: 'flex',
            alignItems: 'center',
            gap: u * 2,
            transform: `scale(${button * pulse})`,
            boxShadow: `0 ${u * 1.5}px ${u * 6}px ${alpha(theme.accent, 0.45)}`,
            maxWidth: box.width,
            whiteSpace: 'nowrap',
          }}
        >
          <span>{localizeDigits(scene.action, lang)}</span>
          <Icon name={lang === 'fa' ? 'arrow-left' : 'arrow-right'} size={u * 5.5} color={theme.onAccent} stroke={2.4} />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: `linear-gradient(110deg, transparent ${shimmer - 15}%, rgba(255,255,255,0.55) ${shimmer}%, transparent ${shimmer + 15}%)`,
            }}
          />
        </div>
      ) : null}
      {scene.url || scene.handle ? (
        <div style={{ opacity: link, fontFamily: 'Inter, Vazirmatn, sans-serif', fontSize: u * 4, color: theme.muted, direction: 'ltr', textAlign: 'center' }}>
          {[scene.url, scene.handle].filter(Boolean).join('  ·  ')}
        </div>
      ) : null}
    </SceneFrame>
  );
};

/** Logo reveal: a circular mask opens on the logo (or word mark) and a light sweep passes. */
export const Logo: React.FC<SceneProps<LogoScene>> = ({ scene }) => {
  const { box, u, theme, assets, fonts } = useStudio();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const open = spring({ frame: frame - 4, fps, config: { damping: 200 }, durationInFrames: 30 });
  const pop = spring({ frame: frame - 8, fps, config: { damping: 11, mass: 0.7 } });
  const sweep = interpolate(frame, [26, 56], [-40, 140], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const ring = interpolate(frame, [0, 40], [0.6, 1.25], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const ringFade = interpolate(frame, [10, 40], [0.8, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const size = Math.min(box.width, box.height) * 0.5;
  const src = scene.image ? assets[scene.image]?.src : undefined;
  return (
    <SceneFrame style={{ alignItems: 'center' }} gap={u * 4}>
      <div style={{ position: 'relative', width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `${u * 0.6}px solid ${theme.accent}`, transform: `scale(${ring})`, opacity: ringFade }} />
        <div
          style={{
            width: size,
            height: size,
            borderRadius: '50%',
            overflow: 'hidden',
            clipPath: `circle(${open * 75}% at 50% 50%)`,
            background: src ? 'transparent' : `linear-gradient(145deg, ${theme.accent}, ${theme.accent2})`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: `scale(${0.7 + 0.3 * pop})`,
            position: 'relative',
          }}
        >
          {src ? (
            <Img src={src} style={{ width: '82%', height: '82%', objectFit: 'contain' }} />
          ) : (
            <span style={{ fontFamily: fonts.heading, fontWeight: 900, fontSize: size * 0.42, color: theme.onAccent }}>
              {(scene.text ?? '•').trim().slice(0, 1).toUpperCase()}
            </span>
          )}
          <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(115deg, transparent ${sweep - 20}%, rgba(255,255,255,0.5) ${sweep}%, transparent ${sweep + 20}%)` }} />
        </div>
      </div>
      {scene.text ? (
        <TextBlock text={scene.text} heading align="center" width={box.width} height={u * 16} maxLines={2} maxSize={u * 9} reveal="words" delay={18} where={`${scene.id}.text`} />
      ) : null}
      {scene.tagline ? (
        <TextBlock text={scene.tagline} align="center" width={box.width} height={u * 14} maxLines={2} maxSize={u * 4.8} color={theme.muted} delay={30} where={`${scene.id}.tagline`} />
      ) : null}
    </SceneFrame>
  );
};

