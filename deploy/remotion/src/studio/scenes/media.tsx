import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { ImageMotion, ImageScene, LocationScene, SplitScene } from '../types';
import type { SceneProps } from './frame';
import { Card, Icon, IconTile, Pill, useEnter } from '../ui';
import { localizeDigits, useStudio } from '../layout';
import { SceneFrame } from './frame';
import { TextBlock } from '../text';
import { alpha } from '../themes';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** Ken Burns transform for a motion over the scene's length. */
function kenBurns(motion: ImageMotion, t: number): string {
  switch (motion) {
    case 'zoom-out':
      return `scale(${1.18 - 0.14 * t})`;
    case 'pan-left':
      return `scale(1.16) translateX(${4 - 8 * t}%)`;
    case 'pan-right':
      return `scale(1.16) translateX(${-4 + 8 * t}%)`;
    case 'still':
      return 'scale(1.02)';
    default:
      return `scale(${1.02 + 0.14 * t}) translate(${-1 * t}%, ${-1.5 * t}%)`;
  }
}

/** Full-bleed photo with Ken Burns, a parallax text layer and a legibility gradient. */
export const Photo: React.FC<SceneProps<ImageScene>> = ({ scene, frames }) => {
  const { box, u, theme, assets, safe, rtl } = useStudio();
  const frame = useCurrentFrame();
  const t = interpolate(frame, [0, frames], [0, 1], { ...clamp, easing: Easing.inOut(Easing.sin) });
  const asset = assets[scene.image];
  const parallax = interpolate(frame, [0, frames], [u * 3, -u * 3], clamp);
  return (
    <AbsoluteFill style={{ background: theme.base[0] }}>
      <AbsoluteFill style={{ overflow: 'hidden' }}>
        {asset ? <Img src={asset.src} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: kenBurns(scene.motion, t) }} /> : null}
      </AbsoluteFill>
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0.15) 55%, rgba(0,0,0,0.78) 100%)' }} />
      <SceneFrame justify="flex-end" gap={u * 2} style={{ transform: `translateY(${parallax}px)` }}>
        {scene.headline ? (
          <TextBlock text={scene.headline} heading width={box.width} height={box.height * 0.32} maxLines={3} maxSize={u * 10} reveal="words" color="#ffffff" where={`${scene.id}.headline`} style={{ textShadow: '0 2px 18px rgba(0,0,0,0.5)' }} />
        ) : null}
        {scene.caption ? (
          <TextBlock text={scene.caption} width={box.width} height={box.height * 0.18} maxLines={3} maxSize={u * 4.6} color="rgba(255,255,255,0.88)" delay={20} where={`${scene.id}.caption`} />
        ) : null}
      </SceneFrame>
      {asset?.credit ? (
        <div dir="ltr" style={{ position: 'absolute', bottom: safe.bottom * 0.35, [rtl ? 'left' : 'right']: safe.end, fontFamily: 'Inter, sans-serif', fontSize: u * 2.4, color: 'rgba(255,255,255,0.75)' }}>
          {asset.credit}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

/** Text on one side, a visual (photo in a frame, or a glowing icon) on the other. */
export const Split: React.FC<SceneProps<SplitScene>> = ({ scene, frames }) => {
  const { box, u, theme, landscape, assets } = useStudio();
  const frame = useCurrentFrame();
  const visualIn = useEnter(4, { damping: 15 });
  const gap = u * 4;
  const visualW = landscape ? box.width * 0.44 : box.width;
  const visualH = landscape ? box.height : box.height * 0.4;
  const textW = landscape ? box.width - visualW - gap : box.width;
  const textH = landscape ? box.height : box.height - visualH - gap;
  const t = interpolate(frame, [0, frames], [0, 1], clamp);
  const asset = scene.image ? assets[scene.image] : undefined;
  const orbit = (frame / 30) * 0.8;
  const visual = (
    <div style={{ width: visualW, height: visualH, position: 'relative', flexShrink: 0, opacity: visualIn, transform: `scale(${0.9 + 0.1 * visualIn})` }}>
      {asset ? (
        <div style={{ position: 'absolute', inset: 0, borderRadius: u * 4, overflow: 'hidden', border: `1px solid ${theme.border}`, boxShadow: `0 ${u * 2}px ${u * 8}px rgba(0,0,0,0.35)` }}>
          <Img src={asset.src} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: kenBurns('zoom-in', t) }} />
        </div>
      ) : (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', width: Math.min(visualW, visualH) * 0.86, height: Math.min(visualW, visualH) * 0.86, borderRadius: '50%', background: `radial-gradient(circle, ${alpha(theme.accent, 0.35)}, transparent 68%)` }} />
          {[0, 1, 2].map((i) => {
            const a = orbit + (i * Math.PI * 2) / 3;
            const r = Math.min(visualW, visualH) * 0.36;
            return <div key={i} style={{ position: 'absolute', width: u * 2.4, height: u * 2.4, borderRadius: '50%', background: i % 2 ? theme.accent2 : theme.accent, transform: `translate(${Math.cos(a) * r}px, ${Math.sin(a) * r}px)` }} />;
          })}
          <IconTile name={scene.icon} size={Math.min(visualW, visualH) * 0.42} delay={6} solid />
        </div>
      )}
    </div>
  );
  const text = (
    <div style={{ width: textW, height: textH, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: u * 2.4 }}>
      <TextBlock text={scene.headline} heading width={textW} height={textH * 0.42} maxLines={3} maxSize={u * 8.5} reveal="words" where={`${scene.id}.headline`} />
      {scene.body ? <TextBlock text={scene.body} width={textW} height={textH * 0.3} maxLines={4} maxSize={u * 4.4} color={theme.muted} delay={18} where={`${scene.id}.body`} /> : null}
      {scene.bullets.map((bullet, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: u * 1.6 }}>
          <Icon name="check" size={u * 4} color={theme.accent} />
          <TextBlock text={bullet} width={textW - u * 7} height={u * 9} maxLines={2} maxSize={u * 4} weight={600} delay={22 + i * 6} where={`${scene.id}.bullets[${i}]`} />
        </div>
      ))}
    </div>
  );
  const visualFirst = scene.side === 'start';
  return (
    <SceneFrame>
      <div style={{ display: 'flex', flexDirection: landscape ? 'row' : 'column', gap, alignItems: 'center' }}>
        {landscape && !visualFirst ? (
          <>
            {text}
            {visual}
          </>
        ) : (
          <>
            {visual}
            {text}
          </>
        )}
      </div>
    </SceneFrame>
  );
};

/** Map-free location card: a dropping pin, pulse rings and an abstract coordinate grid. */
export const Location: React.FC<SceneProps<LocationScene>> = ({ scene }) => {
  const { box, u, theme, lang } = useStudio();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const drop = spring({ frame: frame - 6, fps, config: { damping: 9, mass: 0.8 } });
  const cardIn = useEnter(0, { damping: 18 });
  const size = Math.min(box.width, box.height * 0.5);
  const rings = [0, 1, 2].map((i) => ((frame + i * 20) % 60) / 60);
  return (
    <SceneFrame gap={u * 3}>
      {scene.label ? <Pill delay={2}>{localizeDigits(scene.label, lang)}</Pill> : null}
      <Card pad={0} style={{ width: box.width, height: size, position: 'relative', overflow: 'hidden', opacity: cardIn, transform: `translateY(${(1 - cardIn) * u * 6}px)` }}>
        <AbsoluteFill
          style={{
            backgroundImage: `linear-gradient(${alpha(theme.accent, 0.12)} 1px, transparent 1px), linear-gradient(90deg, ${alpha(theme.accent, 0.12)} 1px, transparent 1px)`,
            backgroundSize: `${u * 7}px ${u * 7}px`,
            transform: `perspective(${u * 80}px) rotateX(48deg) scale(1.6) translateY(${-(frame * 0.4) % (u * 7)}px)`,
            transformOrigin: '50% 70%',
          }}
        />
        <svg width={box.width} height={size} style={{ position: 'absolute', inset: 0 }}>
          <path d={`M ${box.width * 0.1} ${size * 0.8} C ${box.width * 0.3} ${size * 0.3}, ${box.width * 0.6} ${size * 0.9}, ${box.width * 0.9} ${size * 0.35}`} stroke={alpha(theme.accent2, 0.5)} strokeWidth={u * 0.6} strokeDasharray={`${u * 1.6} ${u * 1.6}`} fill="none" strokeDashoffset={-frame} />
        </svg>
        <div style={{ position: 'absolute', left: '50%', top: '58%' }}>
          {rings.map((r, i) => (
            <div key={i} style={{ position: 'absolute', width: u * 30 * r, height: u * 12 * r, left: (-u * 30 * r) / 2, top: (-u * 12 * r) / 2, borderRadius: '50%', border: `2px solid ${theme.accent}`, opacity: (1 - r) * drop }} />
          ))}
          <div style={{ position: 'absolute', left: -u * 9, top: -u * 18 - (1 - drop) * size * 0.6, width: u * 18, height: u * 18, display: 'flex', justifyContent: 'center' }}>
            <Icon name={scene.icon} size={u * 18} color={theme.accent} stroke={1.6} style={{ filter: `drop-shadow(0 ${u}px ${u * 2}px ${alpha(theme.accent, 0.5)})` }} />
          </div>
        </div>
      </Card>
      <TextBlock text={scene.place} heading width={box.width} height={box.height * 0.16} maxLines={2} maxSize={u * 10} reveal="words" delay={12} where={`${scene.id}.place`} />
      {scene.region ? <TextBlock text={scene.region} width={box.width} height={u * 8} maxLines={1} maxSize={u * 5} color={theme.accent} weight={700} delay={20} where={`${scene.id}.region`} /> : null}
      {scene.detail ? <TextBlock text={scene.detail} width={box.width} height={box.height * 0.14} maxLines={3} maxSize={u * 4.2} color={theme.muted} delay={26} where={`${scene.id}.detail`} /> : null}
    </SceneFrame>
  );
};
